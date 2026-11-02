/**
 * After a game's sync changes, the coach's own playlist clips of that game
 * follow it: each vertical pan moves with its clip's cut, and every shared
 * clip whose cut moved is re-cut in the background, the new file replacing
 * the old only once it is uploaded (players never lose a clip mid-update).
 * A moved clip that can't be re-cut here (no video file, or its cut fails) is
 * hidden instead, so "Upload missing clips" offers it: a shared clip never
 * keeps playing the wrong moment.
 * Runs from wherever the sync changed: the game page, a re-import, the editor.
 */
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { clipAndShip } from "@/lib/clip-and-ship";
import { isLocalPath } from "@/lib/stream";
import { probeVideoPath } from "@/lib/video-probe";
import { clearShippedClip, listOwnClipsForMatch, updateClip } from "@/lib/playlists-db";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { shiftKeyframes, type CropKeyframe } from "@scoutable/shared/lib/crop-path";
import { createLatestRuns } from "@scoutable/shared/lib/latest";
import { planSyncRecut } from "@scoutable/shared/lib/sync-recut";
import type { OwnMatchClip } from "@scoutable/shared/lib/playlists-db";
import type { ExportSegment } from "@/lib/export";
import type { StoredMatch, SyncPoint } from "@/types/match";

/** What changed on one playlist clip, for an open editor to patch its copy. */
export interface ClipPatch {
  playlistId: string;
  matchId: string;
  eventId: number;
  /** A new upload's URL, or null when the clip was hidden. */
  r2Url?: string | null;
  cropKeyframes?: CropKeyframe[];
}

/** Fired on window as "playlist-clips-patched" with { patches: ClipPatch[] }. */
export const CLIPS_PATCHED_EVENT = "playlist-clips-patched";

function announcePatches(patches: ClipPatch[]) {
  if (patches.length > 0) window.dispatchEvent(new CustomEvent(CLIPS_PATCHED_EVENT, { detail: { patches } }));
}

/** One run per game: a newer change for the same game stops the older run at once. */
const runs = createLatestRuns();

/** Whether a game's clips are following a sync change right now. */
export function isSyncRefreshRunning(matchId: string): boolean {
  return runs.isRunning(matchId);
}

type SyncedGame = Pick<StoredMatch, "id" | "title" | "videoUrl" | "events" | "syncPoint">;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Stop serving clips that still hold the old cut; returns the patches for an open editor. */
async function hideClips(rows: OwnMatchClip[]): Promise<ClipPatch[]> {
  const patches: ClipPatch[] = [];
  for (const row of rows) {
    try {
      await clearShippedClip(row.playlistId, row.clip.matchId, row.clip.eventId, row.clip.r2Url);
      patches.push({ playlistId: row.playlistId, matchId: row.clip.matchId, eventId: row.clip.eventId, r2Url: null });
    } catch (e) {
      Sentry.captureException(e);
    }
  }
  announcePatches(patches);
  return patches;
}

/**
 * Bring the game's clips in the coach's playlists in line with its new sync
 * (`match.syncPoint`; `before` is the sync they were made with). Safe to
 * call when nothing moved: it then does nothing. A newer change for the same
 * game stops this run and starts over.
 */
export async function afterSyncChange(match: SyncedGame, before: SyncPoint | undefined): Promise<void> {
  const after = match.syncPoint;
  if (!after) return;
  const signal = runs.start(match.id);
  try {
    await followSync(match, after, before, signal);
  } finally {
    runs.finish(match.id, signal);
  }
}

async function followSync(match: SyncedGame, after: SyncPoint, before: SyncPoint | undefined, signal: AbortSignal) {
  let rows: OwnMatchClip[];
  try {
    rows = await listOwnClipsForMatch(match.id);
  } catch (e) {
    Sentry.captureException(e);
    return;
  }
  if (rows.length === 0 || signal.aborted) return;
  const eventById = new Map(match.events.map((e) => [e.eventId, e]));

  // Pans: keyframes are absolute video seconds, so they move with the cut.
  if (before) {
    const patches: ClipPatch[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const kfs = row.clip.cropKeyframes;
        const event = eventById.get(row.clip.eventId);
        if (!kfs?.length || !event) return;
        const was = computeVideoTime(event, before);
        const now = computeVideoTime(event, after);
        if (was === null || now === null || Math.abs(now - was) < 0.001) return;
        const moved = shiftKeyframes(kfs, now - was);
        try {
          await updateClip(row.playlistId, row.clip.matchId, row.clip.eventId, { cropKeyframes: moved });
          row.clip.cropKeyframes = moved;
          patches.push({ playlistId: row.playlistId, matchId: row.clip.matchId, eventId: row.clip.eventId, cropKeyframes: moved });
        } catch (e) {
          Sentry.captureException(e);
        }
      }),
    );
    announcePatches(patches);
  }

  // Shared clips whose cut moved.
  const videoPath = match.videoUrl && isLocalPath(match.videoUrl) ? match.videoUrl : null;
  const canCut = !!videoPath && (await probeVideoPath(videoPath).then((p) => p.status === "ok", () => false));
  if (signal.aborted) return;
  const plan = planSyncRecut(rows, eventById, after, canCut);
  const toastId = `sync-clips-${match.id}`;
  if (plan.hide.length > 0) {
    const hidden = await hideClips(plan.hide);
    toast.warning(`${plural(hidden.length, "shared clip")} from ${match.title} hidden until re-uploaded`, {
      id: toastId,
      description: "Link the game's video file, then use Upload missing clips.",
    });
    trackEvent("shared_clips_recut", { game_id: match.id, clips: 0, failed: 0, hidden: hidden.length, playlists: 0 });
    return;
  }
  if (plan.recut.length === 0) return;
  // One clipAndShip call per playlist and roll pair: a clip keeps the length it was cut at.
  const groups = new Map<string, typeof plan.recut>();
  for (const item of plan.recut) {
    const key = `${item.row.playlistId}|${item.rolls.pre}|${item.rolls.post}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const total = plan.recut.length;
  let done = 0;
  let shipped = 0;
  const failedRows: OwnMatchClip[] = [];
  toast.loading(`Updating shared clips · 0 of ${total}`, {
    id: toastId,
    description: "Players keep the old cut until each clip is ready.",
  });
  try {
    for (const group of groups.values()) {
      if (signal.aborted) break;
      const { row: first, rolls } = group[0];
      const segments: ExportSegment[] = group.flatMap(({ row }) => {
        const event = eventById.get(row.clip.eventId);
        if (!event) return [];
        return [{
          kind: "clip" as const,
          videoPath: videoPath!,
          matchId: match.id,
          event,
          syncPoint: after,
          ...(row.clip.preRollOffset !== undefined ? { preRollOffset: row.clip.preRollOffset } : {}),
          ...(row.clip.postRollOffset !== undefined ? { postRollOffset: row.clip.postRollOffset } : {}),
        }];
      });
      const before = done;
      let result: Awaited<ReturnType<typeof clipAndShip>>;
      try {
        result = await clipAndShip(
          { id: first.playlistId, name: first.playlistName, items: group.map((g) => g.row.clip) },
          segments,
          rolls.pre,
          rolls.post,
          {
            replace: true,
            signal,
            onProgress: (n) => toast.loading(`Updating shared clips · ${before + n} of ${total}`, { id: toastId }),
          },
        );
      } catch (e) {
        // The whole group couldn't be cut (e.g. the file went away mid-run).
        Sentry.captureException(e);
        failedRows.push(...group.map((g) => g.row));
        done = before + segments.length;
        continue;
      }
      done = before + segments.length;
      shipped += result.shipped;
      const failedIds = new Set(result.failures.map((f) => f.eventId));
      failedRows.push(...group.filter((g) => failedIds.has(g.row.clip.eventId)).map((g) => g.row));
      announcePatches(
        result.uploaded.map((u) => ({ playlistId: first.playlistId, matchId: u.matchId, eventId: u.eventId, r2Url: u.r2Url })),
      );
      if (result.aborted) break;
    }
    if (signal.aborted) {
      toast.dismiss(toastId);
      return;
    }
    const hidden = failedRows.length > 0 ? await hideClips(failedRows) : [];
    if (hidden.length > 0) {
      toast.error(`${plural(hidden.length, "shared clip")} couldn't be updated`, {
        id: toastId,
        description: "They're hidden from players until you use Upload missing clips.",
      });
    } else {
      toast.success("Shared clips updated", {
        id: toastId,
        description: `${plural(shipped, "clip")} from ${match.title} now follow the new sync.`,
      });
    }
    trackEvent("shared_clips_recut", {
      game_id: match.id,
      clips: shipped,
      failed: failedRows.length,
      hidden: hidden.length,
      playlists: new Set(plan.recut.map((r) => r.row.playlistId)).size,
    });
  } catch (e) {
    Sentry.captureException(e);
    toast.error("Couldn't update the shared clips", {
      id: toastId,
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
