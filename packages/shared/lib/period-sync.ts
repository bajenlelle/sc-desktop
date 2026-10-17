/**
 * Per-quarter sync, for game videos that skip the breaks between quarters.
 * Each cut moves every later play, so a quarter can carry its own sync
 * (SyncPoint.periods); a quarter without one follows the nearest earlier
 * quarter that has one (see syncForPeriod in clip-timing.ts).
 */

import { computeVideoTime } from "./clip-timing";
import { periodLabel } from "./events";
import type { PeriodMark, PeriodSync, PlayByPlayEvent, SyncAnchorKind, SyncPoint } from "../types/match";

const isTime = (s: unknown): s is string => typeof s === "string" && !Number.isNaN(new Date(s).getTime());
const isSeconds = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * A stored sync point with its per-period parts checked. Entries that can't
 * place a play (a bad time, or period "1", which is the top-level sync) are
 * dropped rather than trusted. The Q1 fields are left as they are.
 */
export function normalizeSyncPoint(raw: SyncPoint): SyncPoint {
  const out: SyncPoint = { ...raw };

  if ("periods" in raw) {
    const periods: Record<string, PeriodSync> = {};
    for (const [key, ps] of Object.entries(raw.periods ?? {})) {
      const p = Number(key);
      if (Number.isInteger(p) && p >= 2 && ps && isSeconds(ps.syncVideoTime) && isTime(ps.syncRealWorldTime)) {
        periods[String(p)] = ps;
      }
    }
    if (Object.keys(periods).length > 0) out.periods = periods;
    else delete out.periods;
  }

  if ("marks" in raw) {
    const marks: Record<string, PeriodMark> = {};
    for (const [key, m] of Object.entries(raw.marks ?? {})) {
      const p = Number(key);
      if (!Number.isInteger(p) || p < 1 || !m?.anchor || !isTime(m.anchor.realWorldTime)) continue;
      const mark: PeriodMark = { anchor: m.anchor };
      if (isTime(m.startRealWorldTime)) mark.startRealWorldTime = m.startRealWorldTime;
      if (isTime(m.endRealWorldTime)) mark.endRealWorldTime = m.endRealWorldTime;
      marks[String(p)] = mark;
    }
    if (Object.keys(marks).length > 0) out.marks = marks;
    else delete out.marks;
  }

  if ("breaksCut" in raw && typeof raw.breaksCut !== "boolean") delete out.breaksCut;
  return out;
}

/** The fields of a play the period math reads. */
export type PeriodEvent = Pick<
  PlayByPlayEvent,
  "period" | "realWorldTime" | "type" | "isSuccessful" | "eventTeam" | "scoreHome" | "scoreAway"
>;

export interface PeriodAnchor {
  realWorldTime: string;
  kind: SyncAnchorKind;
  label: string;
}

const msOf = (iso: string | undefined | null) => (iso ? new Date(iso).getTime() : Number.NaN);
const MADE_BASKET = new Set(["2pt", "3pt", "freethrow"]);

/** The game's periods in order: every period with a play or a mark. */
export function gamePeriods(events: PeriodEvent[], marks?: SyncPoint["marks"]): number[] {
  const set = new Set<number>();
  for (const e of events) if (Number.isInteger(e.period) && e.period >= 1) set.add(e.period);
  for (const key of Object.keys(marks ?? {})) {
    const p = Number(key);
    if (Number.isInteger(p) && p >= 1) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

function playsByPeriod(events: PeriodEvent[]): Map<number, PeriodEvent[]> {
  const by = new Map<number, PeriodEvent[]>();
  for (const e of events) {
    if (!Number.isFinite(msOf(e.realWorldTime))) continue;
    const list = by.get(e.period) ?? [];
    list.push(e);
    by.set(e.period, list);
  }
  for (const list of by.values()) list.sort((a, b) => msOf(a.realWorldTime) - msOf(b.realWorldTime));
  return by;
}

/**
 * Each period's first made basket as its anchor, from the stored plays: the
 * marks for a game imported before the league's period times were kept.
 * Plays only, so no start or end times.
 */
export function periodMarksFromEvents(events: PeriodEvent[]): Record<string, PeriodMark> {
  const marks: Record<string, PeriodMark> = {};
  for (const [period, plays] of playsByPeriod(events)) {
    const basket = plays.find((e) => e.isSuccessful === 1 && MADE_BASKET.has(e.type));
    const name = periodLabel(period);
    if (basket) {
      const team = basket.eventTeam?.teamName?.trim();
      const score =
        basket.scoreHome != null && basket.scoreAway != null ? ` (${basket.scoreHome}\u2013${basket.scoreAway})` : "";
      marks[String(period)] = {
        anchor: {
          realWorldTime: basket.realWorldTime,
          kind: "first_basket",
          label: team ? `${team}'s first basket of ${name}${score}` : `The first basket of ${name}${score}`,
        },
      };
    } else {
      marks[String(period)] = {
        anchor: { realWorldTime: plays[0].realWorldTime, kind: "play", label: `The first play of ${name}` },
      };
    }
  }
  return marks;
}

/** The game's marks: the league's from the import, else the plays'. */
function marksFor(sync: SyncPoint, events: PeriodEvent[]): Record<string, PeriodMark> {
  const fromPlays = periodMarksFromEvents(events);
  return { ...fromPlays, ...(sync.marks ?? {}) };
}

/** When a period started and ended on the wall clock (ms): the league's marks, else its first and last plays. */
function periodBounds(
  period: number,
  marks: Record<string, PeriodMark>,
  plays: Map<number, PeriodEvent[]>,
): { start: number; end: number } {
  const list = plays.get(period) ?? [];
  const mark = marks[String(period)];
  const start = Number.isFinite(msOf(mark?.startRealWorldTime)) ? msOf(mark?.startRealWorldTime) : msOf(list[0]?.realWorldTime);
  const end = Number.isFinite(msOf(mark?.endRealWorldTime))
    ? msOf(mark?.endRealWorldTime)
    : msOf(list[list.length - 1]?.realWorldTime);
  return { start, end };
}

/** Seconds of wall clock between each period and the one before it (keyed by the later period). */
export function breakSeconds(sync: SyncPoint, events: PeriodEvent[]): Record<string, number> {
  const marks = marksFor(sync, events);
  const plays = playsByPeriod(events);
  const out: Record<string, number> = {};
  const periods = gamePeriods(events, marks);
  for (const p of periods) {
    if (p < 2) continue;
    const gap = (periodBounds(p, marks, plays).start - periodBounds(p - 1, marks, plays).end) / 1000;
    if (Number.isFinite(gap)) out[String(p)] = Math.max(0, gap);
  }
  return out;
}

/** The Q1 sync on its own, as a game without per-period syncs reads it. */
function q1Only(sync: SyncPoint): SyncPoint {
  return { syncVideoTime: sync.syncVideoTime, syncRealWorldTime: sync.syncRealWorldTime };
}

/**
 * Whether the video looks like it skips the breaks: placed with the Q1 sync
 * alone, the play-by-play runs past the end of the video by more than
 * `toleranceSeconds`, and the game had breaks to cut (over a minute in all).
 * `overrunSeconds` is how far past the end the last play lands.
 */
export function videoLooksCut({
  durationSeconds,
  events,
  sync,
  toleranceSeconds = 45,
}: {
  durationSeconds: number | null;
  events: PeriodEvent[];
  sync: SyncPoint;
  toleranceSeconds?: number;
}): { cut: boolean; overrunSeconds: number; breakSeconds: number } {
  const breaks = Object.values(breakSeconds(sync, events)).reduce((a, b) => a + b, 0);
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { cut: false, overrunSeconds: 0, breakSeconds: breaks };
  }
  const q1 = q1Only(sync);
  let last = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    const t = computeVideoTime({ realWorldTime: e.realWorldTime }, q1);
    if (t !== null && t > last) last = t;
  }
  const overrun = Number.isFinite(last) ? Math.max(0, last - durationSeconds) : 0;
  return { cut: overrun > toleranceSeconds && breaks > 60, overrunSeconds: overrun, breakSeconds: breaks };
}

/**
 * The sync each period would have if the video skipped every break: a
 * period without its own sync is placed straight after the previous one
 * ends, less `allowanceSeconds` of break the cut usually leaves in. Earlier
 * predictions chain into later ones. Periods with their own sync are kept.
 */
export function projectedSync(sync: SyncPoint, events: PeriodEvent[], allowanceSeconds = 5): SyncPoint {
  const marks = marksFor(sync, events);
  const plays = playsByPeriod(events);
  const periods: Record<string, PeriodSync> = { ...(sync.periods ?? {}) };
  const projected: SyncPoint = { ...sync, periods };
  for (const p of gamePeriods(events, marks)) {
    if (p < 2 || periods[String(p)]) continue;
    const prevEnd = periodBounds(p - 1, marks, plays).end;
    const { start } = periodBounds(p, marks, plays);
    if (!Number.isFinite(prevEnd) || !Number.isFinite(start)) continue;
    const gap = Math.max(0, (start - prevEnd) / 1000 - allowanceSeconds);
    const anchor = marks[String(p)]?.anchor;
    const anchorTime = anchor?.realWorldTime ?? new Date(start).toISOString();
    const before = computeVideoTime({ realWorldTime: anchorTime, period: p - 1 }, projected);
    if (before === null) continue;
    periods[String(p)] = {
      syncVideoTime: before - gap,
      syncRealWorldTime: anchorTime,
      ...(anchor ? { anchor: { kind: anchor.kind, label: anchor.label } } : {}),
    };
  }
  return projected;
}

/**
 * Where a period's anchor should be in a video that skips the breaks,
 * predicted from the periods before it (never from the period's own sync,
 * so the suggestion stays available after the coach sets one).
 */
export function predictPeriodAnchor(sync: SyncPoint, events: PeriodEvent[], period: number): number | null {
  if (period < 2) return null;
  const { [String(period)]: _own, ...others } = sync.periods ?? {};
  const later = Object.keys(others).filter((k) => Number(k) > period);
  for (const k of later) delete others[k];
  const projected = projectedSync({ ...sync, periods: others }, events);
  const anchor = marksFor(sync, events)[String(period)]?.anchor;
  const own = projected.periods?.[String(period)];
  if (!own) return null;
  return anchor ? computeVideoTime({ realWorldTime: anchor.realWorldTime, period }, projected) : own.syncVideoTime;
}

export interface PeriodRow {
  period: number;
  /** "Q2", "OT1". */
  name: string;
  /** What to look for in the video. */
  anchor: PeriodAnchor | null;
  /** The period has its own sync; otherwise it follows `follows`. */
  set: boolean;
  follows: number;
  /** Where the anchor is in the video with the current syncs. */
  videoTime: number | null;
  /** Where it should be if the video skips the breaks. */
  suggested: number | null;
}

/** The rows of a quarter-by-quarter sync, Q2 onward. */
export function describePeriodSyncs(sync: SyncPoint, events: PeriodEvent[]): PeriodRow[] {
  const marks = marksFor(sync, events);
  const rows: PeriodRow[] = [];
  for (const p of gamePeriods(events, marks)) {
    if (p < 2) continue;
    const anchor = marks[String(p)]?.anchor ?? null;
    const own = sync.periods?.[String(p)];
    let follows = 1;
    for (const k of Object.keys(sync.periods ?? {})) {
      const q = Number(k);
      if (q < p && q > follows) follows = q;
    }
    rows.push({
      period: p,
      name: periodLabel(p),
      anchor,
      set: !!own,
      follows,
      videoTime: anchor ? computeVideoTime({ realWorldTime: anchor.realWorldTime, period: p }, sync) : null,
      suggested: predictPeriodAnchor(sync, events, p),
    });
  }
  return rows;
}

/** A period's own sync, placed on its anchor at `videoTime` in the video. Period 1 is the game's sync point. */
export function setPeriodSync(sync: SyncPoint, period: number, videoTime: number, anchor: PeriodAnchor): SyncPoint {
  if (period <= 1) return { ...sync, syncVideoTime: videoTime };
  return {
    ...sync,
    periods: {
      ...(sync.periods ?? {}),
      [String(period)]: {
        syncVideoTime: videoTime,
        syncRealWorldTime: anchor.realWorldTime,
        anchor: { kind: anchor.kind, label: anchor.label },
      },
    },
  };
}

/** Drops a period's own sync: it follows the nearest earlier period again. */
export function clearPeriodSync(sync: SyncPoint, period: number): SyncPoint {
  if (!sync.periods?.[String(period)]) return sync;
  const { [String(period)]: _gone, ...rest } = sync.periods;
  const next: SyncPoint = { ...sync, periods: rest };
  if (Object.keys(rest).length === 0) delete next.periods;
  return next;
}

/** Drops every per-period sync: the whole game follows Q1 again. */
export function clearAllPeriodSyncs(sync: SyncPoint): SyncPoint {
  const { periods: _gone, ...rest } = sync;
  return rest;
}

/**
 * Moves a period (and every later period that follows it) by `deltaSeconds`.
 * A period without its own sync gets one, on its mark's anchor when there
 * is one, so the game page can show where that quarter is set.
 */
export function shiftPeriod(sync: SyncPoint, events: PeriodEvent[], period: number, deltaSeconds: number): SyncPoint {
  if (period <= 1) return { ...sync, syncVideoTime: sync.syncVideoTime + deltaSeconds };
  const own = sync.periods?.[String(period)];
  if (own) {
    return {
      ...sync,
      periods: { ...sync.periods, [String(period)]: { ...own, syncVideoTime: own.syncVideoTime + deltaSeconds } },
    };
  }
  const anchor = marksFor(sync, events)[String(period)]?.anchor;
  if (anchor) {
    const at = computeVideoTime({ realWorldTime: anchor.realWorldTime, period }, sync);
    if (at !== null) return setPeriodSync(sync, period, at + deltaSeconds, anchor);
  }
  let base: { syncVideoTime: number; syncRealWorldTime: string } = sync;
  let baseP = 1;
  for (const [k, ps] of Object.entries(sync.periods ?? {})) {
    const q = Number(k);
    if (q < period && q > baseP) {
      base = ps;
      baseP = q;
    }
  }
  return {
    ...sync,
    periods: {
      ...(sync.periods ?? {}),
      [String(period)]: { syncVideoTime: base.syncVideoTime + deltaSeconds, syncRealWorldTime: base.syncRealWorldTime },
    },
  };
}

/** Moves every period of the game by `deltaSeconds`. */
export function shiftWholeGame(sync: SyncPoint, deltaSeconds: number): SyncPoint {
  const next: SyncPoint = { ...sync, syncVideoTime: sync.syncVideoTime + deltaSeconds };
  if (sync.periods) {
    next.periods = Object.fromEntries(
      Object.entries(sync.periods).map(([k, ps]) => [k, { ...ps, syncVideoTime: ps.syncVideoTime + deltaSeconds }]),
    );
  }
  return next;
}

