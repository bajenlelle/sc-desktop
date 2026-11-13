/**
 * Sending a shared playlist's clips to the cloud, from wherever the coach
 * is: the editor (its deferred ship, "Upload missing clips") and the game
 * view ("Send n clips", in place). One path, so both say and do the same.
 *
 * The caller owns what is on screen while it runs (the editor's toolbar
 * indicator, the game view's progress toast) and what happens to its copy of
 * the playlist afterwards (`onUploaded`): this module cuts, uploads, counts,
 * toasts the outcome and tells the pending shares.
 */
import { toast } from "sonner";
import type { ClipShipResult } from "@scoutable/shared/lib/ship-result";
import { isClipItem, type Playlist, type PlayByPlayEvent, type StoredMatch } from "@/types/match";
import { trackEvent } from "@/lib/analytics";
import { clipAndShip } from "@/lib/clip-and-ship";
import type { ExportSegment } from "@/lib/export";
import { notifyPendingPlaylistShares } from "@/lib/playlists-db";

/** The clip length a playlist is cut with until the coach changes it in the editor (seconds). */
export const DEFAULT_PRE_ROLL = 10;
export const DEFAULT_POST_ROLL = 3;

export type MatchLookup = ReadonlyMap<string, StoredMatch>;
export type EventLookup = ReadonlyMap<string, PlayByPlayEvent>;

/** `matchId:eventId` → event, over these games' plays. */
export function eventLookup(matches: Iterable<StoredMatch>): Map<string, PlayByPlayEvent> {
  const map = new Map<string, PlayByPlayEvent>();
  for (const m of matches) {
    for (const e of m.events) map.set(`${m.id}:${e.eventId}`, e);
  }
  return map;
}

// Built from pl.items (not the selected playlist's queue) so a deferred
// ship stays correct when the coach has switched focus to another playlist.
// Upload order doesn't matter, so no sort is applied.
// Shipped clips stay plain cuts: the players draw the note, the drawings and
// the slow motion themselves, so editing them never needs a re-upload.
export function buildShipSegments(pl: Playlist, matchLookup: MatchLookup, eventByKey: EventLookup): ExportSegment[] {
  return pl.items
    .filter(isClipItem)
    .map((clip): ExportSegment | null => {
      const m = matchLookup.get(clip.matchId);
      if (!m?.videoUrl || !m.syncPoint) return null;
      const event = eventByKey.get(`${clip.matchId}:${clip.eventId}`);
      if (!event) return null;
      const seg: ExportSegment = {
        kind: "clip",
        videoPath: m.videoUrl,
        matchId: clip.matchId,
        event,
        syncPoint: m.syncPoint,
      };
      if (clip.preRollOffset !== undefined)
        (seg as Extract<ExportSegment, { kind: "clip" }>).preRollOffset = clip.preRollOffset;
      if (clip.postRollOffset !== undefined)
        (seg as Extract<ExportSegment, { kind: "clip" }>).postRollOffset = clip.postRollOffset;
      return seg;
    })
    .filter((x): x is ExportSegment => x !== null);
}

/**
 * Sharing ships clips to the cloud, which the sample game can't do — its
 * video is a remote stream, not a local file, so Clip & Ship's preflight
 * would throw a raw path error. Mirror the export gate's friendly copy.
 */
export function demoShipBlockReason(pl: Playlist, matchLookup: MatchLookup): string | null {
  const hasDemoClip = pl.items
    .filter(isClipItem)
    .some((c) => matchLookup.get(c.matchId)?.isDemo);
  return hasDemoClip
    ? "The sample game can't be shared — import your own game to share clips with your team."
    : null;
}

export interface ShipOptions {
  matchLookup: MatchLookup;
  eventByKey: EventLookup;
  preRoll: number;
  postRoll: number;
  onProgress?: (done: number, total: number) => void;
  /** The uploads that landed, for the caller's copy of the playlist; called before the outcome is said. */
  onUploaded?: (uploaded: ClipShipResult["uploaded"], playlistId: string) => void;
  /** The toast the outcome replaces (a progress toast); none: the outcome is a toast of its own. */
  toastId?: string;
  /** What to say when clips went up; the editor's "Clips uploaded to …" otherwise. */
  success?: (shipped: number, total: number) => { title: string; description?: string };
}

/**
 * Cuts and uploads the playlist's clips that have no file yet (clipAndShip
 * is idempotent: the rest are skipped), patches the caller's copy, says how
 * it went and notifies pending silent shares. Never throws: a failure is a
 * toast. Returns the result, or null when nothing ran (the preflight threw).
 * The caller checks `demoShipBlockReason` first.
 */
export async function shipPlaylistClips(target: Playlist, opts: ShipOptions): Promise<ClipShipResult | null> {
  const { toastId } = opts;
  try {
    const segments = buildShipSegments(target, opts.matchLookup, opts.eventByKey);
    const result = await clipAndShip(target, segments, opts.preRoll, opts.postRoll, {
      onProgress: opts.onProgress,
    });
    opts.onUploaded?.(result.uploaded, target.id);

    const total = segments.length;
    const uploadedCount = result.shipped + result.skipped;
    if (result.failures.length > 0) {
      trackEvent("playlist_ship_failed", { playlist_id: target.id, failed: result.failures.length, total });
      toast.error(
        `${result.failures.length} of ${total} clips in "${target.name}" didn't upload`,
        { id: toastId, description: "Recipients can't see these clips yet — try again from Shared by me." },
      );
    } else if (result.shipped > 0) {
      // Silent when everything was already in the cloud (idempotent re-run).
      const said = opts.success?.(result.shipped, total) ?? {
        title: `Clips uploaded to "${target.name}"`,
        description: `${uploadedCount} clip${uploadedCount === 1 ? " is" : "s are"} now in the cloud.`,
      };
      toast.success(said.title, { id: toastId, description: said.description });
      trackEvent("playlist_shipped", { playlist_id: target.id, clip_count: uploadedCount });
    } else if (toastId) {
      toast.dismiss(toastId);
    }

    if (uploadedCount > 0) {
      // Best-effort and idempotent — a no-op unless silent pending shares exist.
      await notifyPendingPlaylistShares(target.id).catch(() => {});
    }
    return result;
  } catch (e) {
    toast.error("Clip & Ship failed", { id: toastId, description: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
