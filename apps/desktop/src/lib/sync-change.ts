/**
 * After a game's sync changes, the coach's own playlist clips of that game
 * follow it: each vertical pan moves with its clip's cut, and every shared
 * clip whose cut moved is re-cut in the background, the new file replacing
 * the old only once it is uploaded (players never lose a clip mid-update).
 * Runs from wherever the sync changed: the game page, a re-import, the editor.
 */
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { clipAndShip } from "@/lib/clip-and-ship";
import { isLocalPath } from "@/lib/stream";
import { listOwnClipsForMatch, updateClip } from "@/lib/playlists-db";
import { clipBounds, computeVideoTime, isShippedClipStale, playlistRolls } from "@scoutable/shared/lib/clip-timing";
import { shiftKeyframes, type CropKeyframe } from "@scoutable/shared/lib/crop-path";
import type { OwnMatchClip } from "@scoutable/shared/lib/playlists-db";
import type { ExportSegment } from "@/lib/export";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

/** What changed on one playlist clip, for an open editor to patch its copy. */
export interface ClipPatch {
  playlistId: string;
  matchId: string;
  eventId: number;
  r2Url?: string;
  cropKeyframes?: CropKeyframe[];
}

/** Fired on window as "playlist-clips-patched" with { patches: ClipPatch[] }. */
export const CLIPS_PATCHED_EVENT = "playlist-clips-patched";

function announcePatches(patches: ClipPatch[]) {
  if (patches.length > 0) window.dispatchEvent(new CustomEvent(CLIPS_PATCHED_EVENT, { detail: { patches } }));
}

/** Games whose shared clips are being re-cut now; the editor's own refresh leaves them alone. */
const running = new Map<string, AbortController>();

export function isSyncRefreshRunning(matchId: string): boolean {
  return running.has(matchId);
}

type SyncedGame = Pick<StoredMatch, "id" | "title" | "videoUrl" | "events" | "syncPoint">;

/** Where a clip's cut starts with `sync`, for its playlist's pair and its own offsets. */
function cutStart(event: PlayByPlayEvent, sync: SyncPoint, row: OwnMatchClip): number | null {
  const t = computeVideoTime(event, sync);
  if (t === null) return null;
  const pair = playlistRolls(row);
  return clipBounds(t, pair.pre, pair.post, row.clip.preRollOffset, row.clip.postRollOffset).start;
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
  let rows: OwnMatchClip[];
  try {
    rows = await listOwnClipsForMatch(match.id);
  } catch (e) {
    Sentry.captureException(e);
    return;
  }
  if (rows.length === 0) return;
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
  const stale = rows.filter((row) => {
    const event = eventById.get(row.clip.eventId);
    return !!event && isShippedClipStale(row.clip, playlistRolls(row), cutStart(event, after, row));
  });
  if (stale.length === 0) return;
  const toastId = `sync-clips-${match.id}`;
  if (!match.videoUrl || !isLocalPath(match.videoUrl)) {
    toast.warning(`${stale.length} shared clip${stale.length === 1 ? "" : "s"} from ${match.title} still play the old cut`, {
      id: toastId,
      description: "Link the game's video file to update them.",
    });
    return;
  }

  running.get(match.id)?.abort();
  const controller = new AbortController();
  running.set(match.id, controller);
  const byPlaylist = new Map<string, OwnMatchClip[]>();
  for (const row of stale) byPlaylist.set(row.playlistId, [...(byPlaylist.get(row.playlistId) ?? []), row]);

  const total = stale.length;
  let done = 0;
  let shipped = 0;
  let failed = 0;
  toast.loading(`Updating shared clips · 0 of ${total}`, {
    id: toastId,
    description: "Players keep the old cut until each clip is ready.",
  });
  try {
    for (const [playlistId, group] of byPlaylist) {
      if (controller.signal.aborted) break;
      const pair = playlistRolls(group[0]);
      const segments: ExportSegment[] = group.flatMap((row) => {
        const event = eventById.get(row.clip.eventId);
        if (!event) return [];
        return [{
          kind: "clip" as const,
          videoPath: match.videoUrl!,
          matchId: match.id,
          event,
          syncPoint: after,
          ...(row.clip.preRollOffset !== undefined ? { preRollOffset: row.clip.preRollOffset } : {}),
          ...(row.clip.postRollOffset !== undefined ? { postRollOffset: row.clip.postRollOffset } : {}),
        }];
      });
      const before = done;
      const result = await clipAndShip(
        { id: playlistId, name: group[0].playlistName, items: group.map((r) => r.clip) },
        segments,
        pair.pre,
        pair.post,
        {
          replace: true,
          signal: controller.signal,
          onProgress: (n) => toast.loading(`Updating shared clips · ${before + n} of ${total}`, { id: toastId }),
        },
      );
      done = before + segments.length;
      shipped += result.shipped;
      failed += result.failures.length;
      announcePatches(
        result.uploaded.map((u) => ({ playlistId, matchId: u.matchId, eventId: u.eventId, r2Url: u.r2Url })),
      );
      if (result.aborted) break;
    }
    if (controller.signal.aborted) {
      toast.dismiss(toastId);
    } else if (failed > 0) {
      toast.error(`${failed} of ${total} shared clips weren't updated`, {
        id: toastId,
        description: "Players keep the old cut for those.",
      });
    } else {
      toast.success("Shared clips updated", {
        id: toastId,
        description: `${shipped} clip${shipped === 1 ? "" : "s"} from ${match.title} now follow the new sync.`,
      });
    }
    trackEvent("playlist_clip_length_reshipped", { reason: "sync", clips: shipped, failed, playlists: byPlaylist.size });
  } catch (e) {
    Sentry.captureException(e);
    toast.error("Couldn't update the shared clips", {
      id: toastId,
      description: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (running.get(match.id) === controller) running.delete(match.id);
  }
}
