/**
 * Clip time math: where an event sits in the video, and the export window
 * around it. This decides which frames end up in every exported MP4 and every
 * shipped clip — previously four hand-copied implementations in the desktop
 * app.
 */

import type { PlayByPlayEvent, SyncPoint } from "../types/match";

/**
 * Seconds into the video for an event, derived from the match's realtime
 * sync point. Null when either timestamp is missing or unparseable.
 */
export function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

/** Export window around an event time; start clamps at 0. */
export function clipBounds(
  videoTime: number,
  preRoll: number,
  postRoll: number,
  preRollOffset = 0,
  postRollOffset = 0,
): { start: number; end: number } {
  return {
    start: Math.max(0, videoTime - preRoll - preRollOffset),
    end: videoTime + postRoll + postRollOffset,
  };
}

/**
 * R2 object key for a shipped clip. pre/post are the EFFECTIVE totals
 * (base roll + per-clip offset). Already-uploaded clips are addressed by this
 * exact string — changing the format orphans every previously shipped clip,
 * which is why its golden test exists.
 */
export function clipShipKey(matchId: string, eventId: number, pre: number, post: number): string {
  return `clips/${matchId}/${eventId}_pre${pre.toFixed(1)}_post${post.toFixed(1)}.mp4`;
}
