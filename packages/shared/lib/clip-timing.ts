/**
 * Clip time math: where an event sits in the video, and the export window
 * around it. This decides which frames end up in every exported MP4 and every
 * shipped clip — previously four hand-copied implementations in the desktop
 * app.
 */

import type { SyncPoint } from "../types/match";

/**
 * The sync a period's plays are placed with: the period's own (a video that
 * skips the breaks syncs each quarter), else the nearest earlier period's,
 * else the game's Q1 sync point.
 */
export function syncForPeriod(
  sync: SyncPoint,
  period?: number | null,
): { syncVideoTime: number; syncRealWorldTime: string } {
  if (!sync.periods || period == null || !Number.isFinite(period)) return sync;
  let chosen: { syncVideoTime: number; syncRealWorldTime: string } = sync;
  let chosenPeriod = 1;
  for (const [key, ps] of Object.entries(sync.periods)) {
    const p = Number(key);
    if (Number.isInteger(p) && p > chosenPeriod && p <= period) {
      chosen = ps;
      chosenPeriod = p;
    }
  }
  return chosen;
}

/**
 * Seconds into the video for an event, derived from the match's realtime
 * sync point (its period's own, when the video skips the breaks). Null when
 * either timestamp is missing or unparseable.
 */
export function computeVideoTime(
  event: { realWorldTime?: string | null; period?: number | null },
  sync: SyncPoint,
): number | null {
  const s = syncForPeriod(sync, event.period);
  if (!event.realWorldTime || !s.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(s.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return s.syncVideoTime + (eventMs - syncMs) / 1000;
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
 * A position within a clip for a scrubber or trim readout: "0:07.4",
 * "1:02.0". Tenths, because a play is decided in fractions of a second.
 */
export function formatClipTime(seconds: number): string {
  // Round first, so 59.96 reads 1:00.0 rather than 0:60.0.
  const s = Math.round(Math.max(0, seconds) * 10) / 10;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

/**
 * R2 object key for a shipped clip. pre/post are the EFFECTIVE totals
 * (base roll + per-clip offset); start is the computed in-video start second,
 * which depends on the match's sync point — so a re-synced game mints NEW
 * keys, and recipients' browser/CDN caches of the old URL can never serve the
 * old cut. Already-uploaded clips are addressed by this exact string — the
 * golden test pins the format, and the presign-upload edge function's
 * CLIP_KEY allowlist must accept every format ever shipped (keys without the
 * _s segment stay valid: older desktop builds still mint them).
 */
export function clipShipKey(
  matchId: string,
  eventId: number,
  pre: number,
  post: number,
  start: number,
): string {
  return `clips/${matchId}/${eventId}_pre${pre.toFixed(1)}_post${post.toFixed(1)}_s${start.toFixed(1)}.mp4`;
}

/** Post-roll padding baked into shipped clips (desktop authoring default). */
export const CLIP_POST_ROLL_SECONDS = 3;

/**
 * Playback-side watched rule, shared by all three players: a clip counts as
 * watched once playback reaches 3 seconds before the end of the FILE — the
 * action is over by then, the rest is post-roll padding, and skipping ahead
 * at that point is the normal viewing behavior. Floored at 50% of the
 * duration so short clips can't register as watched moments after starting
 * (marking on play would let someone skim the list and register everything).
 */
export function isWatchedPosition(currentTime: number, duration: number): boolean {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return false;
  return currentTime >= Math.max(duration - CLIP_POST_ROLL_SECONDS, duration * 0.5);
}
