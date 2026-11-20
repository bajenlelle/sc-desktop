/**
 * The fives a team used and how long each was on the floor, from the five
 * ids the feed puts on every play (Genius imports since September 2026).
 * Time is the game clock's, exact to the gap between two plays: the stretch
 * between two plays belongs to the five on the later one, the period's start
 * to the first play's five and its end to the last one's. Plays that list no
 * five change nothing.
 */
import type { PlayByPlayEvent } from "../types/match";
import { clockSeconds, gameFlow, periodLengthSeconds } from "./game-flow";

export interface Lineup {
  side: 1 | 2;
  /** Sorted ascending. */
  personIds: readonly number[];
  seconds: number;
  /** The score change for the team while the five was on; null when the game has no score. */
  plusMinus: number | null;
  eventIds: readonly number[];
}

/** A five shown in the table plays at least this long. */
export const LINEUP_MIN_SECONDS = 120;
/** How many fives the table shows before "Show all". */
export const LINEUPS_SHOWN = 5;

/** Fives by time on the floor, longest first. Empty when the game has no fives. */
export function gameLineups(events: readonly PlayByPlayEvent[]): { home: Lineup[]; away: Lineup[] } {
  const flow = gameFlow(events);
  const out = { home: [] as Lineup[], away: [] as Lineup[] };

  for (const side of [1, 2] as const) {
    const byKey = new Map<string, { personIds: number[]; seconds: number; change: number; eventIds: number[] }>();
    const fiveOf = (e: PlayByPlayEvent) => (side === 1 ? e.onCourtHome : e.onCourtAway);
    const entry = (ids: readonly number[]) => {
      const personIds = [...ids].sort((a, b) => a - b);
      const key = personIds.join(",");
      let found = byKey.get(key);
      if (!found) {
        found = { personIds, seconds: 0, change: 0, eventIds: [] };
        byKey.set(key, found);
      }
      return found;
    };

    // The plays that list this side's five, by period, in game order.
    const periods = new Map<number, Array<{ e: PlayByPlayEvent; index: number }>>();
    flow.order.forEach((e, index) => {
      if (!fiveOf(e)?.length) return;
      const list = periods.get(e.period) ?? [];
      list.push({ e, index });
      periods.set(e.period, list);
    });

    for (const [period, plays] of periods) {
      const length = periodLengthSeconds(flow.order, period);
      let before = length;
      for (const { e, index } of plays) {
        const five = entry(fiveOf(e)!);
        five.eventIds.push(e.eventId);
        const clock = clockSeconds(e);
        if (clock >= 0) {
          five.seconds += Math.max(0, before - clock);
          before = clock;
        }
        if (flow.scores.length > 0) {
          const after = flow.scores[index];
          const prev = index === 0 ? { home: 0, away: 0 } : flow.scores[index - 1];
          const change = after.home - after.away - (prev.home - prev.away);
          five.change += side === 1 ? change : -change;
        }
      }
      // The period's end belongs to the last five.
      if (before > 0) entry(fiveOf(plays[plays.length - 1].e)!).seconds += before;
    }

    const lineups = [...byKey.values()]
      .map((l) => ({
        side,
        personIds: l.personIds,
        seconds: l.seconds,
        plusMinus: flow.scores.length > 0 ? l.change : null,
        eventIds: l.eventIds,
      }))
      .sort((a, b) => b.seconds - a.seconds);
    if (side === 1) out.home = lineups;
    else out.away = lineups;
  }
  return out;
}
