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

/** The shortest a clip plays, however its ends were set. */
export const MIN_CLIP_SECONDS = 1;

/**
 * Export window around an event time; start clamps at 0. The totals
 * (roll + offset) may be negative: a clip trimmed onto footage after its
 * play, or before it. A playlist whose clip length was lowered under a
 * heavily trimmed clip could leave it with no length at all, so the end
 * keeps at least MIN_CLIP_SECONDS after the start.
 */
export function clipBounds(
  videoTime: number,
  preRoll: number,
  postRoll: number,
  preRollOffset = 0,
  postRollOffset = 0,
): { start: number; end: number } {
  const start = Math.max(0, videoTime - preRoll - preRollOffset);
  return {
    start,
    end: Math.max(videoTime + postRoll + postRollOffset, start + MIN_CLIP_SECONDS),
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
 * _s segment stay valid: older desktop builds still mint them). A total is
 * negative for a clip that starts after its play or ends before it.
 */
export function clipShipKey(
  matchId: string,
  eventId: number,
  pre: number,
  post: number,
  start: number,
): string {
  return `clips/${matchId}/${eventId}_pre${keySeconds(pre)}_post${keySeconds(post)}_s${keySeconds(start)}.mp4`;
}

/**
 * A number as clipShipKey writes it: toFixed(1), except that a value
 * rounding to zero from below reads "0.0", not "-0.0". Otherwise a clip
 * would mint a "-0.0" key that the stale check, reading it back as 0,
 * finds out of date every time.
 */
function keySeconds(n: number): string {
  const s = n.toFixed(1);
  return s === "-0.0" ? "0.0" : s;
}

/** Post-roll padding baked into shipped clips (desktop authoring default). */
export const CLIP_POST_ROLL_SECONDS = 3;

/** Pre-roll a playlist uses until the coach sets its own (desktop authoring default). */
export const DEFAULT_PRE_ROLL_SECONDS = 10;

/** A playlist's clip length: seconds before and after each event. */
export interface RollPair {
  pre: number;
  post: number;
}

/** The playlist's saved pair, or `fallback` for a playlist that never set one. */
export function playlistRolls(
  playlist: { preRoll?: number; postRoll?: number } | null | undefined,
  fallback: RollPair = { pre: DEFAULT_PRE_ROLL_SECONDS, post: CLIP_POST_ROLL_SECONDS },
): RollPair {
  return { pre: playlist?.preRoll ?? fallback.pre, post: playlist?.postRoll ?? fallback.post };
}

/**
 * The effective totals a shipped clip was cut with, read back from its R2 key
 * (see clipShipKey; keys from before the `_s` segment end in `.mp4` straight
 * after the post-roll). Null for a key this format doesn't describe.
 */
export function shippedTotals(r2Url: string): RollPair | null {
  const m = /_pre(-?\d+(?:\.\d+)?)_post(-?\d+(?:\.\d+)?)(?:_s|\.mp4)/.exec(r2Url);
  return m ? { pre: Number(m[1]), post: Number(m[2]) } : null;
}

/**
 * The in-video start a shipped clip was cut from, read back from its R2 key
 * (clipShipKey's `_s` segment). Null for keys minted before that segment.
 */
export function shippedStart(r2Url: string): number | null {
  const m = /_s(\d+(?:\.\d+)?)\.mp4/.exec(r2Url);
  return m ? Number(m[1]) : null;
}

/**
 * Whether a shipped clip's file no longer matches the playlist's pair plus
 * the clip's own offsets, or (given `expectedStart`) where the game's sync
 * now puts it, compared the way clipShipKey writes them (one decimal). An
 * unshipped clip or an unknown key format is never stale: there is nothing
 * to compare and nothing to replace. A key without a start is never stale on
 * its start alone.
 */
export function isShippedClipStale(
  clip: { r2Url?: string; preRollOffset?: number; postRollOffset?: number },
  pair: RollPair,
  expectedStart?: number | null,
): boolean {
  if (!clip.r2Url) return false;
  const shipped = shippedTotals(clip.r2Url);
  if (!shipped) return false;
  if (
    keySeconds(shipped.pre) !== keySeconds(pair.pre + (clip.preRollOffset ?? 0)) ||
    keySeconds(shipped.post) !== keySeconds(pair.post + (clip.postRollOffset ?? 0))
  ) {
    return true;
  }
  if (expectedStart == null) return false;
  const start = shippedStart(clip.r2Url);
  return start !== null && keySeconds(start) !== keySeconds(expectedStart);
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
