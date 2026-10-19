/**
 * Clip time math: where an event sits in the video, and the export window
 * around it. This decides which frames end up in every exported MP4 and every
 * shipped clip — previously four hand-copied implementations in the desktop
 * app.
 *
 * The window math itself (computeVideoTime, clipBounds, clipShipKey, the
 * stale checks) lives in clip-ship-plan.ts, an import-free file the
 * `game-video` function plans server cuts with; it is re-exported here so
 * the apps keep one import.
 */

export {
  CLIP_POST_ROLL_SECONDS,
  DEFAULT_PRE_ROLL_SECONDS,
  MIN_CLIP_SECONDS,
  clipBounds,
  clipShipKey,
  computeVideoTime,
  isShippedClipStale,
  playlistRolls,
  shippedStart,
  shippedTotals,
  syncForPeriod,
  type RollPair,
} from "./clip-ship-plan";

import { CLIP_POST_ROLL_SECONDS, type RollPair } from "./clip-ship-plan";

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
 * m:ss.d for the tip-off picker's readout, floored to the tenth so the
 * displayed frame is never ahead of the playhead; negative values (a
 * recording that starts after the tip-off) keep their sign. The desktop's
 * sync-point-picker.tsx carries the same function until it imports this one.
 */
export function formatMSSd(secs: number): string {
  const sign = secs < 0 ? "−" : "";
  const a = Math.abs(secs);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  const d = Math.floor((a % 1) * 10);
  return `${sign}${m}:${String(s).padStart(2, "0")}.${d}`;
}

const hundredths = (n: number) => Math.round(n * 100) / 100;

/**
 * A clip's offsets under another pair that keep its length unchanged: for a
 * clip copied to a playlist with a different pair, or added from a preview
 * whose pair differs from the playlist's.
 */
export function rebaseOffsets(
  clip: { preRollOffset?: number; postRollOffset?: number },
  from: RollPair,
  to: RollPair,
): { preRollOffset: number; postRollOffset: number } {
  return {
    preRollOffset: hundredths((clip.preRollOffset ?? 0) + from.pre - to.pre),
    postRollOffset: hundredths((clip.postRollOffset ?? 0) + from.post - to.post),
  };
}

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
