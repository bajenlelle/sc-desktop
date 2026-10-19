/**
 * The clip-window math every shipped clip file is cut by: where an event
 * sits in the video, the window around it, and the public key the file is
 * stored under. The `game-video` function imports this file by relative path
 * to plan a playlist's cuts on the server, so it has NO imports (Deno
 * resolves relative specifiers literally and can't follow the extensionless
 * `../types/match` import clip-timing.ts carries); the sync type is spelled
 * out structurally instead. clip-timing.ts re-exports everything here, so the
 * apps keep importing from there.
 */

/** One sync: a video time and the real-world time it corresponds to. */
export interface PeriodSyncLike {
  syncVideoTime: number;
  syncRealWorldTime: string;
}

/** The parts of a match's SyncPoint the window math reads (types/match.ts SyncPoint is assignable). */
export interface SyncPointLike extends PeriodSyncLike {
  /** Per-period syncs, keyed by global period, for a video that skips the breaks. */
  periods?: Record<string, PeriodSyncLike> | null;
}

/**
 * The sync a period's plays are placed with: the period's own (a video that
 * skips the breaks syncs each quarter), else the nearest earlier period's,
 * else the game's Q1 sync point.
 */
export function syncForPeriod(sync: SyncPointLike, period?: number | null): PeriodSyncLike {
  if (!sync.periods || period == null || !Number.isFinite(period)) return sync;
  let chosen: PeriodSyncLike = sync;
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
  sync: SyncPointLike,
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
export function clipShipKey(matchId: string, eventId: number, pre: number, post: number, start: number): string {
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
  playlist: { preRoll?: number | null; postRoll?: number | null } | null | undefined,
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
  clip: { r2Url?: string | null; preRollOffset?: number | null; postRollOffset?: number | null },
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
