/**
 * After a game's sync changes, the coach's own playlist clips of that game
 * follow it (followSyncChange in @scoutable/shared/lib/sync-follow): pans
 * move with their clip's cut, shared clips whose cut moved are re-cut here
 * with the local file and the bundled ffmpeg, or hidden when the video isn't
 * on this computer. This is the desktop host: one run per game, the cutter,
 * the toasts, analytics and the window event an open editor listens to.
 * Runs from wherever the sync changed: the game page, a re-import, the editor.
 */
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { clipAndShip } from "@/lib/clip-and-ship";
import { isLocalPath } from "@/lib/stream";
import { probeVideoPath } from "@/lib/video-probe";
import { createClient } from "@/lib/supabase/client";
import { createLatestRuns } from "@scoutable/shared/lib/latest";
import {
  followSyncChange,
  type ClipPatch,
  type RecutGroup,
  type RecutOutcome,
  type SyncedGame,
} from "@scoutable/shared/lib/sync-follow";
import type { ExportSegment } from "@/lib/export";
import type { SyncPoint } from "@/types/match";

export type { ClipPatch };

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The video can be cut here: a local file that is where the game says it is. */
async function canCutHere(videoUrl: string | undefined): Promise<boolean> {
  if (!videoUrl || !isLocalPath(videoUrl)) return false;
  return probeVideoPath(videoUrl).then((p) => p.status === "ok", () => false);
}

/** One group cut again with ffmpeg and uploaded, the progress on the game's toast. */
async function recutGroup(
  match: SyncedGame,
  after: SyncPoint,
  group: RecutGroup,
  done: number,
  total: number,
  signal: AbortSignal,
  toastId: string,
): Promise<RecutOutcome> {
  const eventById = new Map(match.events.map((e) => [e.eventId, e]));
  const segments: ExportSegment[] = group.rows.flatMap(({ clip }) => {
    const event = eventById.get(clip.eventId);
    if (!event) return [];
    return [{
      kind: "clip" as const,
      videoPath: match.videoUrl!,
      matchId: match.id,
      event,
      syncPoint: after,
      ...(clip.preRollOffset !== undefined ? { preRollOffset: clip.preRollOffset } : {}),
      ...(clip.postRollOffset !== undefined ? { postRollOffset: clip.postRollOffset } : {}),
    }];
  });
  if (done === 0) {
    toast.loading(`Updating shared clips · 0 of ${total}`, {
      id: toastId,
      description: "Players keep the old cut until each clip is ready.",
    });
  }
  const result = await clipAndShip(
    { id: group.playlistId, name: group.playlistName, items: group.rows.map((r) => r.clip) },
    segments,
    group.rolls.pre,
    group.rolls.post,
    {
      replace: true,
      signal,
      onProgress: (n) => toast.loading(`Updating shared clips · ${done + n} of ${total}`, { id: toastId }),
    },
  );
  return {
    shipped: result.shipped,
    failedEventIds: result.failures.map((f) => f.eventId),
    uploaded: result.uploaded.map((u) => ({ matchId: u.matchId, eventId: u.eventId, r2Url: u.r2Url })),
    aborted: result.aborted,
  };
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
  const toastId = `sync-clips-${match.id}`;
  try {
    const result = await followSyncChange(createClient(), match, before, signal, {
      canCut: canCutHere,
      recut: (group, done, total) => recutGroup(match, after, group, done, total, signal, toastId),
      onPatches: announcePatches,
    });
    if (result.kind === "hidden") {
      toast.warning(`${plural(result.hidden, "shared clip")} from ${match.title} hidden until re-uploaded`, {
        id: toastId,
        description: "Link the game's video file, then use Upload missing clips.",
      });
      trackEvent("shared_clips_recut", { game_id: match.id, clips: 0, failed: 0, hidden: result.hidden, playlists: 0 });
    } else if (result.kind === "recut") {
      if (result.hidden > 0) {
        toast.error(`${plural(result.hidden, "shared clip")} couldn't be updated`, {
          id: toastId,
          description: "They're hidden from players until you use Upload missing clips.",
        });
      } else {
        toast.success("Shared clips updated", {
          id: toastId,
          description: `${plural(result.shipped, "clip")} from ${match.title} now follow the new sync.`,
        });
      }
      trackEvent("shared_clips_recut", {
        game_id: match.id,
        clips: result.shipped,
        failed: result.failed,
        hidden: result.hidden,
        playlists: result.playlists,
      });
    } else if (result.kind === "aborted") {
      toast.dismiss(toastId);
    }
  } catch (e) {
    // The clips couldn't be listed: nothing was started, nothing to show.
    Sentry.captureException(e);
  } finally {
    runs.finish(match.id, signal);
  }
}
