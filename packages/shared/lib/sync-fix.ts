/**
 * What a Fix sync saves. The coach found where a play really happens; how
 * far the move reaches is the scope: "Only this clip" moves the clip alone
 * (its own offsets, no new sync), "From this play on" cuts the video from
 * where the clip starts, "This quarter" shifts the quarter and the ones that
 * follow it (and says the video skips the breaks), "The whole game" shifts
 * every quarter.
 */
import type { SyncPoint } from "../types/match";
import { computeVideoTime } from "./clip-timing";
import { shiftPeriod, shiftWholeGame, syncFromPlayOn, type PeriodEvent } from "./period-sync";
import type { SyncFixScope } from "./sync-reach";

export interface SyncFixPlan {
  /** The game's new sync; null when only the clip moves. */
  next: SyncPoint | null;
  /** How far the play moved, in seconds (later is positive). */
  delta: number;
}

/** The fix for `event` found at `found` seconds in the video; null when the sync can't place the play. */
export function planSyncFix(
  sync: SyncPoint,
  events: PeriodEvent[],
  event: { eventId: number; period: number; realWorldTime?: string | null },
  scope: SyncFixScope,
  found: number,
  leadSeconds: number,
): SyncFixPlan | null {
  const mapped = computeVideoTime(event, sync);
  if (mapped === null) return null;
  const delta = found - mapped;
  const next =
    scope === "quarter"
      ? { ...shiftPeriod(sync, events, event.period, delta), ...(event.period >= 2 ? { breaksCut: true } : {}) }
      : scope === "play" && event.realWorldTime
        ? syncFromPlayOn(sync, { realWorldTime: event.realWorldTime, period: event.period, eventId: event.eventId }, found, leadSeconds)
        : scope === "game"
          ? shiftWholeGame(sync, delta)
          : null;
  return { next, delta };
}
