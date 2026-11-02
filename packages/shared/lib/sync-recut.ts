/**
 * Which shared clips a sync change moved, and how to cut them again. A
 * shipped clip's key records the totals it was cut with and where it starts
 * in the video (clipShipKey), so a clip keeps its own length when it is re-cut
 * and only clips whose start actually moved are touched.
 */

import type { SyncPoint } from "../types/match";
import { clipBounds, computeVideoTime, shippedStart, shippedTotals } from "./clip-timing";

type ShippedClip = { r2Url?: string; preRollOffset?: number; postRollOffset?: number };
type TimedEvent = { realWorldTime?: string | null; period?: number | null };

/**
 * The playlist rolls to re-cut a shipped clip with after a sync change (its
 * key's totals minus the clip's own offsets), or null when its cut didn't
 * move or can't be compared: not shipped, a key without a start, or a play
 * the sync can't place. Compared in the key's tenths.
 */
export function movedClipRolls(
  clip: ShippedClip,
  event: TimedEvent,
  sync: SyncPoint,
): { pre: number; post: number } | null {
  if (!clip.r2Url) return null;
  const totals = shippedTotals(clip.r2Url);
  const start = shippedStart(clip.r2Url);
  if (!totals || start === null) return null;
  const t = computeVideoTime(event, sync);
  if (t === null) return null;
  const expected = clipBounds(t, totals.pre, totals.post).start;
  if (expected.toFixed(1) === start.toFixed(1)) return null;
  return { pre: totals.pre - (clip.preRollOffset ?? 0), post: totals.post - (clip.postRollOffset ?? 0) };
}

/**
 * Split a game's shared clips after a sync change: the moved ones are re-cut
 * when the video can be cut here, and hidden otherwise (their r2_url cleared,
 * so "Upload missing clips" offers them) — a shared clip never keeps playing
 * the wrong moment.
 */
export function planSyncRecut<R extends { clip: ShippedClip & { eventId: number } }>(
  rows: R[],
  events: Map<number, TimedEvent>,
  sync: SyncPoint,
  canCut: boolean,
): { recut: Array<{ row: R; rolls: { pre: number; post: number } }>; hide: R[] } {
  const recut: Array<{ row: R; rolls: { pre: number; post: number } }> = [];
  const hide: R[] = [];
  for (const row of rows) {
    const event = events.get(row.clip.eventId);
    if (!event) continue;
    const rolls = movedClipRolls(row.clip, event, sync);
    if (!rolls) continue;
    if (canCut) recut.push({ row, rolls });
    else hide.push(row);
  }
  return { recut, hide };
}
