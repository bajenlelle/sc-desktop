/**
 * The reach of a Fix sync choice, for the strip that shows a coach which
 * quarters move: each period of the game as a segment, the part of it that
 * moves (as fractions of its wall-clock span), and where the play sits.
 */

import { periodLabel } from "./events";
import { describePeriodSyncs, nextFixAfter, periodSpans, type PeriodEvent } from "./period-sync";
import type { SyncPoint } from "../types/match";

/** How far a fix reaches: this clip alone, this play and every later one, this quarter and the ones that follow it, or the whole game. */
export type SyncFixScope = "clip" | "play" | "quarter" | "game";

export interface ReachSegment {
  period: number;
  /** "Q2", "OT1". */
  name: string;
  /** The period has its own sync (Q1 always: it is the game's sync point). */
  set: boolean;
  /** The part of the period that moves, as fractions of its span; null when it stays. */
  moved: { from: number; to: number } | null;
}

export interface SyncReach {
  segments: ReachSegment[];
  /** Where the play sits: its period, and how far into that period's span. */
  play: { period: number; at: number } | null;
}

/** "Q3", "Q3 and Q4", "Q2, Q3 and Q4". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const hasOwnSync = (sync: SyncPoint, period: number) => period === 1 || !!sync.periods?.[String(period)];

/** The quarters "From this quarter on" moves: the play's, and every later one that follows it. */
export function quartersMoved(sync: SyncPoint, events: PeriodEvent[], period: number): string[] {
  const names = [periodLabel(period)];
  for (const row of describePeriodSyncs(sync, events)) {
    if (row.period <= period) continue;
    if (row.set) break;
    names.push(row.name);
  }
  return names;
}

/** What `scope` moves for the play `event`; null scope = nothing chosen yet. */
export function syncReach(
  sync: SyncPoint,
  events: PeriodEvent[],
  event: { period: number; realWorldTime?: string | null },
  scope: SyncFixScope | null,
): SyncReach {
  const spans = periodSpans(sync, events);
  const fraction = (period: number, iso: string | null | undefined): number | null => {
    const span = spans.find((s) => s.period === period);
    const t = iso ? new Date(iso).getTime() : Number.NaN;
    if (!span || Number.isNaN(t)) return null;
    if (span.end <= span.start) return 0.5;
    return Math.min(1, Math.max(0, (t - span.start) / (span.end - span.start)));
  };
  const at = fraction(event.period, event.realWorldTime);
  const play = at === null ? null : { period: event.period, at };

  // Where "From this play on" stops: before the next quarter with its own
  // sync, or at a later fix inside the quarters it moves.
  let stop: { period: number; at: number } | null = null;
  if (scope === "play" && event.realWorldTime) {
    const next = nextFixAfter(sync, { realWorldTime: event.realWorldTime, period: event.period });
    if (next?.kind === "period") stop = { period: next.period, at: 0 };
    else if (next?.kind === "cut") {
      const cut = sync.cuts?.find((c) => c.syncRealWorldTime === next.realWorldTime);
      const f = cut ? fraction(cut.period, cut.syncRealWorldTime) : null;
      if (cut && f !== null) stop = { period: cut.period, at: f };
    }
  }
  const quarters = scope === "quarter" ? new Set(quartersMoved(sync, events, event.period)) : null;

  const segments = spans.map((span): ReachSegment => {
    const name = periodLabel(span.period);
    let moved: ReachSegment["moved"] = null;
    if (scope === "game") moved = { from: 0, to: 1 };
    else if (quarters?.has(name)) moved = { from: 0, to: 1 };
    else if (scope === "play" && play) {
      const from = span.period === play.period ? play.at : span.period > play.period ? 0 : null;
      if (from !== null) {
        if (stop && span.period > stop.period) moved = null;
        else if (stop && span.period === stop.period) moved = stop.at > from ? { from, to: stop.at } : null;
        else moved = { from, to: 1 };
      }
    }
    return { period: span.period, name, set: hasOwnSync(sync, span.period), moved };
  });
  return { segments, play };
}

/**
 * One play from each other quarter of the game that is in the playlist, the
 * nearest in time to `play`: the ones a coach checks to see where the drift
 * starts. In quarter order; plays without a time don't count.
 */
export function pickPeekPlays<E extends { period: number; realWorldTime?: string | null; eventId: number }>(
  play: E,
  others: E[],
): E[] {
  const at = play.realWorldTime ? new Date(play.realWorldTime).getTime() : Number.NaN;
  const best = new Map<number, { e: E; d: number }>();
  for (const e of others) {
    if (e.period === play.period) continue;
    const t = e.realWorldTime ? new Date(e.realWorldTime).getTime() : Number.NaN;
    if (Number.isNaN(t)) continue;
    const d = Number.isNaN(at) ? e.eventId : Math.abs(t - at);
    const cur = best.get(e.period);
    if (!cur || d < cur.d || (d === cur.d && e.eventId < cur.e.eventId)) best.set(e.period, { e, d });
  }
  return [...best.entries()].sort(([a], [b]) => a - b).map(([, v]) => v.e);
}
