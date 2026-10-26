/**
 * Generating a scouting report on the desktop: what turns a playlist of
 * player cards and clips into a published page (lib/scouting-report.ts builds
 * its content, the web app's /r/<id> shows it).
 *
 * The order, and why:
 *   1. clips: the page plays the clip files recipients already get (the
 *      public per-clip cuts Clip & Ship uploads), so the ones with no file yet
 *      are cut and uploaded first. Idempotent: a clip that has one is skipped.
 *   2. posters: one JPEG frame per clip (a video doesn't print, its poster
 *      does), cut from the coach's local game video and uploaded as the
 *      coach's own highlights/<user>/<uuid>.jpg. Best effort: a missing
 *      poster leaves a placeholder, never a failed report.
 *   3. publish: the only step that makes anything public. Cancelling before
 *      it publishes nothing; the clips and posters already up are harmless.
 */
import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { clipAndShip } from "@/lib/clip-and-ship";
import { uploadToR2 } from "@/lib/r2-upload";
import { publishScoutingReport } from "@/lib/scouting-reports-db";
import type { ExportSegment } from "@/lib/export";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { isExportCancelled } from "@scoutable/shared/lib/export-progress";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import type { ReportDraft } from "@scoutable/shared/lib/report-draft";
import { buildScoutingReport, clampReportTitle, type MissingClip } from "@scoutable/shared/lib/scouting-report";
import { scoutingReportUrl } from "@scoutable/shared/lib/scouting-reports-db";
import type { ClipShipFailure, ClipShipResult } from "@scoutable/shared/lib/ship-result";
import { isClipItem, type PlayByPlayEvent, type Playlist, type PlaylistItem, type SyncPoint } from "@/types/match";

export type ReportStage = "clips" | "posters" | "publishing";

export interface ReportProgress {
  stage: ReportStage;
  done: number;
  total: number;
}

/** Where a game's video is on this computer and how it lines up with the plays. */
export interface ClipSource {
  videoPath: string;
  syncPoint: SyncPoint;
}

export interface GenerateReportArgs {
  /** The playlist as the editor holds it. */
  playlist: Playlist;
  /** The report's draft (lib/report-draft.ts): the players, notes and where clips go. */
  draft: ReportDraft;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  /** The clip segments Clip & Ship cuts, for the whole playlist (the page's buildShipSegments). */
  shipSegments: ExportSegment[];
  /** A game's local video and sync, or null where this computer has none. */
  clipSource: (matchId: string) => ClipSource | null;
  matchLabel: (matchId: string) => string;
  /** The coach's labels per clip, by clip item key. */
  labelsByKey: ReadonlyMap<string, readonly string[]>;
  preRoll: number;
  postRoll: number;
  title: string;
  opponent: string | null;
  /** The "made with" mark: always on Rookie, the coach's watermark setting on Pro and Franchise. */
  attribution: boolean;
  /** Publish with the clips that could not be uploaded left out. */
  allowMissing: boolean;
  signal: AbortSignal;
  onProgress: (p: ReportProgress) => void;
  /** Called with every clip file uploaded, so the editor keeps its playlist's file URLs current. */
  onShipped: (uploaded: ClipShipResult["uploaded"]) => void;
}

export type GenerateOutcome =
  | {
      kind: "published";
      id: string;
      url: string;
      expiresAt: string;
      /** False when the playlist's live report was updated in place (the same link). */
      created: boolean;
      clips: number;
      posters: number;
      shipped: number;
      /** Clips the page leaves out: not on this computer, or no longer in the game's data. */
      leftOut: MissingClip[];
    }
  | { kind: "clips_failed"; failures: ClipShipFailure[]; shipped: number }
  | { kind: "cancelled"; stage: ReportStage };

const WEB_APP_URL = "https://app.scoutable.se";

/** The web app's address: the real one, or the local web app for a build against staging (whose data the real one can't see). */
export function reportBaseUrl(): string {
  return import.meta.env.VITE_ENV === "staging" ? "http://localhost:3000" : WEB_APP_URL;
}

const POSTER_CONCURRENCY = 3;

/** Runs `work` over `items` with at most `limit` in flight; stops taking new ones once aborted. */
export async function pool<T>(items: readonly T[], limit: number, signal: AbortSignal, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal.aborted) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** The items with freshly uploaded file URLs on their clips. */
function withUploads(items: PlaylistItem[], uploaded: ClipShipResult["uploaded"]): PlaylistItem[] {
  if (uploaded.length === 0) return items;
  const byKey = new Map(uploaded.map((u) => [`${u.matchId}:${u.eventId}`, u.r2Url]));
  return items.map((i) => (isClipItem(i) && byKey.has(itemKey(i)) ? { ...i, r2Url: byKey.get(itemKey(i))! } : i));
}

export async function generateScoutingReport(args: GenerateReportArgs): Promise<GenerateOutcome> {
  const { eventByKey, signal, onProgress } = args;
  const title = clampReportTitle(args.title);
  let items = args.playlist.items;
  let shipped = 0;

  const build = (posters?: ReadonlyMap<string, string>) =>
    buildScoutingReport({
      draft: args.draft,
      playlist: { items },
      eventByKey,
      matchLabel: args.matchLabel,
      title,
      opponent: args.opponent,
      posters,
      labelsByKey: args.labelsByKey,
      attribution: args.attribution,
    });

  // 1. Clips that have no hosted file yet.
  if (build().missing.some((m) => m.reason === "not_shipped")) {
    onProgress({ stage: "clips", done: 0, total: 1 });
    const result = await clipAndShip({ ...args.playlist, items }, args.shipSegments, args.preRoll, args.postRoll, {
      signal,
      onProgress: (done, total) => onProgress({ stage: "clips", done, total }),
    });
    args.onShipped(result.uploaded);
    items = withUploads(items, result.uploaded);
    shipped = result.shipped;
    if (result.aborted || signal.aborted) return { kind: "cancelled", stage: "clips" };
    if (result.failures.length > 0 && !args.allowMissing) return { kind: "clips_failed", failures: result.failures, shipped };
  }

  // 2. A poster per clip, cut from the coach's local video.
  const first = build();
  const clips = first.report.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "clip");
  const left = new Set(first.missing.map((m) => m.key));
  const posterTargets = items.filter(isClipItem).filter((i) => !left.has(itemKey(i)));
  const posters = new Map<string, string>();
  if (clips.length > 0) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    const tempDir = await invoke<string>("get_temp_dir");
    let done = 0;
    onProgress({ stage: "posters", done, total: posterTargets.length });
    await pool(posterTargets, POSTER_CONCURRENCY, signal, async (item) => {
      const key = itemKey(item);
      const source = args.clipSource(item.matchId);
      const event = eventByKey.get(key);
      const at = source && event ? computeVideoTime(event, source.syncPoint) : null;
      if (source && at !== null) {
        const tempPath = `${tempDir}/sc_poster_${crypto.randomUUID()}.jpg`;
        try {
          await invoke("extract_clip_poster", { videoPath: source.videoPath, atSeconds: at, outputPath: tempPath });
          const posterKey = `highlights/${user.id}/${crypto.randomUUID()}.jpg`;
          await uploadToR2(tempPath, posterKey, "image/jpeg", signal);
          posters.set(key, posterKey);
        } catch (e) {
          if (signal.aborted || isExportCancelled(e)) return;
          // Best effort: this clip's page shows a placeholder.
        } finally {
          invoke("delete_file", { path: tempPath }).catch(() => {});
        }
      }
      done++;
      onProgress({ stage: "posters", done, total: posterTargets.length });
    });
    if (signal.aborted) return { kind: "cancelled", stage: "posters" };
  }

  // 3. Publish.
  onProgress({ stage: "publishing", done: 0, total: 1 });
  const final = build(posters);
  const published = await publishScoutingReport({
    playlistId: args.playlist.id,
    title,
    report: final.report,
    contentKey: final.contentKey,
  });
  onProgress({ stage: "publishing", done: 1, total: 1 });
  return {
    kind: "published",
    id: published.id,
    url: scoutingReportUrl(reportBaseUrl(), published.id),
    expiresAt: published.expiresAt,
    created: published.created,
    clips: final.report.header.clips,
    posters: posters.size,
    shipped,
    leftOut: final.missing,
  };
}
