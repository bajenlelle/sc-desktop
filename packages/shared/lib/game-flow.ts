/**
 * How a game went, read from its plays: the score after every basket, each
 * quarter's score, lead changes, ties, the largest leads, scoring runs, the
 * plays that fall in the moments a coach looks for, and when a player was on
 * the floor. Pure; the game view (docs/game-view.md) draws from it.
 *
 * Two facts checked against 51 cached SBF games (2026-11-11) shape it:
 *   - The points of the made shots add up to the feed's final score in every
 *     game, and every made shot names its team. So the score is added up from
 *     the made shots: it can never step backwards, whatever order the rows
 *     are in. The feed's own running score is the cross-check, and the
 *     fallback when the two disagree.
 *   - Rows are most consistent ordered by period, then the game clock
 *     counting down, then action number (the feed's running score stepped
 *     back 16 times in 23,148 plays that way, 53 by action number alone).
 *     That is "game order" here.
 */
import type { GameMarks, GameTimeout } from "../types/game-marks";
import type { PlayByPlayEvent } from "../types/match";
import { parseGameClock } from "./events";

/** Unanswered points by one team that count as a run. */
export const RUN_MIN_POINTS = 8;
/** Clutch time: this much left in the fourth quarter or overtime… */
export const CLUTCH_SECONDS = 300;
/** …with the score within this many points before the play. */
export const CLUTCH_MARGIN = 5;
/** The start and the end of a quarter: its first and last two minutes. */
export const EDGE_SECONDS = 120;

const SHOT_POINTS: Record<string, number> = { "2pt": 2, "3pt": 3, freethrow: 1 };
/** How a possession after a timeout ends: what a coach wants to see of it. */
const POSSESSION_ENDS = new Set(["2pt", "3pt", "turnover", "foul"]);
/** Quarter lengths in use; a period's length snaps up to the nearest. */
const PERIOD_LENGTHS = [300, 480, 600, 720];

export type ScoreSource = "plays" | "feed" | "none";

export interface Score {
  home: number;
  away: number;
}

/** A change of score: the basket, who scored, and the score after it. */
export interface ScorePoint {
  eventId: number;
  period: number;
  clock: string;
  /** 1 = home, 2 = away; null when the feed's score moved without saying who. */
  team: 1 | 2 | null;
  points: number;
  home: number;
  away: number;
  /** home − away after the basket. */
  diff: number;
}

export interface PeriodScore {
  period: number;
  /** Points scored in the period. */
  home: number;
  away: number;
  /** The score when it ended. */
  homeTotal: number;
  awayTotal: number;
}

export interface ScoringRun {
  team: 1 | 2;
  points: number;
  /** The period its first basket is in. */
  period: number;
  fromEventId: number;
  toEventId: number;
}

export interface LeadPeak {
  lead: number;
  eventId: number;
}

export interface GameFlow {
  /** "plays": added up from made shots. "feed": the feed's running score. "none": the game has no score to read. */
  source: ScoreSource;
  /** The plays in game order. */
  order: readonly PlayByPlayEvent[];
  /** A play's place in `order`, by eventId. */
  indexOf: ReadonlyMap<number, number>;
  /** The score after each play of `order`. Empty when source is "none". */
  scores: readonly Score[];
  /** Whether game order used the game clock (every play has one) or the wall clock. */
  byClock: boolean;
  points: ScorePoint[];
  final: Score | null;
  periods: PeriodScore[];
  /** The baskets that changed who leads, by eventId. */
  leadChanges: number[];
  /** The baskets that tied the game, by eventId. */
  ties: number[];
  largestLead: { home: LeadPeak | null; away: LeadPeak | null };
  runs: ScoringRun[];
}

const msOf = (iso: string | undefined | null) => (iso ? new Date(iso).getTime() : Number.NaN);

/** Seconds left on the game clock; −1 when the play has none. */
export function clockSeconds(e: { gameClockTime?: string | null }): number {
  const s = parseGameClock(e.gameClockTime ?? "");
  return Number.isFinite(s) && s >= 0 ? s : -1;
}

function teamOf(e: PlayByPlayEvent): 1 | 2 | null {
  const n = e.eventTeam?.teamNumber ?? e.player?.teamNumber;
  return n === 1 || n === 2 ? n : null;
}

/**
 * The plays in game order: period, then the game clock counting down, then
 * action number. A game where some play has no clock (district feeds) goes by
 * the wall clock instead.
 */
export function gameOrder<T extends Pick<PlayByPlayEvent, "eventId" | "period" | "gameClockTime" | "realWorldTime">>(
  events: readonly T[],
): { order: T[]; byClock: boolean } {
  const keyed = events.map((e) => {
    const at = msOf(e.realWorldTime);
    return { e, clock: clockSeconds(e), at: Number.isFinite(at) ? at : Infinity };
  });
  const byClock = keyed.length > 0 && keyed.every((k) => k.clock >= 0);
  keyed.sort(
    (a, b) =>
      a.e.period - b.e.period ||
      (byClock ? b.clock - a.clock : a.at === b.at ? 0 : a.at - b.at) ||
      a.e.eventId - b.e.eventId,
  );
  return { order: keyed.map((k) => k.e), byClock };
}

/** The feed's running score, where it has one. */
function feedScore(e: PlayByPlayEvent): Score | null {
  return typeof e.scoreHome === "number" && typeof e.scoreAway === "number" ? { home: e.scoreHome, away: e.scoreAway } : null;
}

/**
 * The game's score story. `runMinPoints` is how many unanswered points make
 * a run (RUN_MIN_POINTS).
 */
export function gameFlow(events: readonly PlayByPlayEvent[], opts: { runMinPoints?: number } = {}): GameFlow {
  const runMin = opts.runMinPoints ?? RUN_MIN_POINTS;
  const { order, byClock } = gameOrder(events);
  const indexOf = new Map<number, number>();
  order.forEach((e, i) => indexOf.set(e.eventId, i));

  // Added up from the made shots.
  let home = 0;
  let away = 0;
  let teamless = false;
  const fromPlays: Score[] = [];
  const playPoints: ScorePoint[] = [];
  for (const e of order) {
    const value = e.isSuccessful ? SHOT_POINTS[e.type] : undefined;
    if (value) {
      const team = teamOf(e);
      if (team === 1) home += value;
      else if (team === 2) away += value;
      else teamless = true;
      if (team) {
        playPoints.push({
          eventId: e.eventId,
          period: e.period,
          clock: e.gameClockTime ?? "",
          team,
          points: value,
          home,
          away,
          diff: home - away,
        });
      }
    }
    fromPlays.push({ home, away });
  }

  // The feed's own final, to check against.
  let feedHome = -1;
  let feedAway = -1;
  for (const e of order) {
    const s = feedScore(e);
    if (!s) continue;
    feedHome = Math.max(feedHome, s.home);
    feedAway = Math.max(feedAway, s.away);
  }
  const hasFeed = feedHome >= 0 && feedAway >= 0;

  let source: ScoreSource;
  let scores: Score[];
  let points: ScorePoint[];
  if (!teamless && (!hasFeed || (feedHome === home && feedAway === away))) {
    source = "plays";
    scores = fromPlays;
    points = playPoints;
  } else if (hasFeed) {
    source = "feed";
    scores = [];
    points = [];
    let prev: Score = { home: 0, away: 0 };
    for (const e of order) {
      const s = feedScore(e);
      if (s && (s.home !== prev.home || s.away !== prev.away)) {
        const dHome = s.home - prev.home;
        const dAway = s.away - prev.away;
        points.push({
          eventId: e.eventId,
          period: e.period,
          clock: e.gameClockTime ?? "",
          team: dHome > 0 && dAway === 0 ? 1 : dAway > 0 && dHome === 0 ? 2 : null,
          points: dHome + dAway,
          home: s.home,
          away: s.away,
          diff: s.home - s.away,
        });
        prev = s;
      }
      scores.push(prev);
    }
  } else {
    source = "none";
    scores = [];
    points = [];
  }

  const final = source === "none" ? null : points.length > 0 ? { home: points[points.length - 1].home, away: points[points.length - 1].away } : { home: 0, away: 0 };

  // Each period's score.
  const periods: PeriodScore[] = [];
  if (source !== "none") {
    const seen = [...new Set(order.map((e) => e.period))].sort((a, b) => a - b);
    let total: Score = { home: 0, away: 0 };
    for (const period of seen) {
      let last = total;
      for (const p of points) if (p.period === period) last = { home: p.home, away: p.away };
      periods.push({ period, home: last.home - total.home, away: last.away - total.away, homeTotal: last.home, awayTotal: last.away });
      total = last;
    }
  }

  // Lead changes, ties, the largest leads and the runs.
  const leadChanges: number[] = [];
  const ties: number[] = [];
  const largestLead: GameFlow["largestLead"] = { home: null, away: null };
  const runs: ScoringRun[] = [];
  let leader: 1 | 2 | null = null;
  // Held in an object: the compiler can't follow a closure that reassigns a `let`.
  const current: { run: ScoringRun | null } = { run: null };
  const endRun = () => {
    if (current.run && current.run.points >= runMin) runs.push(current.run);
    current.run = null;
  };
  for (const p of points) {
    if (p.diff === 0) {
      if (p.home + p.away > 0) ties.push(p.eventId);
    } else {
      const now = p.diff > 0 ? 1 : 2;
      if (leader && now !== leader) leadChanges.push(p.eventId);
      leader = now;
      if (now === 1 && (!largestLead.home || p.diff > largestLead.home.lead)) largestLead.home = { lead: p.diff, eventId: p.eventId };
      if (now === 2 && (!largestLead.away || -p.diff > largestLead.away.lead)) largestLead.away = { lead: -p.diff, eventId: p.eventId };
    }
    if (!p.team || p.points <= 0) {
      endRun();
      continue;
    }
    if (current.run && current.run.team === p.team) {
      current.run.points += p.points;
      current.run.toEventId = p.eventId;
    } else {
      endRun();
      current.run = { team: p.team, points: p.points, period: p.period, fromEventId: p.eventId, toEventId: p.eventId };
    }
  }
  endRun();

  return { source, order, indexOf, scores, byClock, points, final, periods, leadChanges, ties, largestLead, runs };
}

/** The score after a play, or null when the game has no score or the play isn't in it. */
export function scoreAfter(flow: GameFlow, eventId: number): Score | null {
  const i = flow.indexOf.get(eventId);
  return i === undefined ? null : (flow.scores[i] ?? null);
}

/** The score before a play: after the play ahead of it in game order. */
export function scoreBefore(flow: GameFlow, eventId: number): Score | null {
  const i = flow.indexOf.get(eventId);
  if (i === undefined || flow.scores.length === 0) return null;
  return i === 0 ? { home: 0, away: 0 } : flow.scores[i - 1];
}

/**
 * How long a period is, in seconds of game clock: the longest clock its kind
 * of period shows (regulation quarters together, overtimes together), snapped
 * up to a length in use. 10:00 for a quarter and 5:00 for an overtime when
 * the plays have no clock.
 */
export function periodLengthSeconds(events: readonly Pick<PlayByPlayEvent, "period" | "gameClockTime">[], period: number): number {
  const overtime = period > 4;
  let longest = -1;
  for (const e of events) {
    if (e.period > 4 !== overtime) continue;
    longest = Math.max(longest, clockSeconds(e));
  }
  if (longest < 0) return overtime ? 300 : 600;
  return PERIOD_LENGTHS.find((len) => len >= longest) ?? Math.ceil(longest / 60) * 60;
}

/**
 * The play each timeout leads to: the first shot, turnover or foul after it
 * in the same period, which is how the possession out of the timeout ended.
 * Null when the period ended first. Every timeout is listed, the officials'
 * too.
 */
export function afterTimeoutPlays(
  flow: GameFlow,
  marks: GameMarks | null | undefined,
): Array<{ timeout: GameTimeout; eventId: number | null }> {
  if (!marks) return [];
  return marks.timeouts.map((timeout) => {
    const clock = clockSeconds({ gameClockTime: timeout.clock });
    const at = msOf(timeout.resumeRealWorldTime ?? timeout.realWorldTime);
    const useClock = flow.byClock && clock >= 0;
    for (const e of flow.order) {
      if (e.period !== timeout.period || !POSSESSION_ENDS.has(e.type)) continue;
      const after = useClock
        ? clockSeconds(e) < clock || (clockSeconds(e) === clock && e.eventId > timeout.eventId)
        : msOf(e.realWorldTime) >= at;
      if (after) return { timeout, eventId: e.eventId };
    }
    return { timeout, eventId: null };
  });
}

/** The moments a coach filters a game by. */
export type GameMoment = "after_timeout" | "quarter_start" | "quarter_end" | "clutch" | "run" | "fast_break";

export const GAME_MOMENTS: readonly GameMoment[] = [
  "after_timeout",
  "quarter_start",
  "quarter_end",
  "clutch",
  "run",
  "fast_break",
];

/**
 * Which moments each play belongs to, by eventId; a play in none is left out.
 *   - after_timeout: the play a team's timeout leads to (afterTimeoutPlays).
 *   - quarter_start / quarter_end: the first and last EDGE_SECONDS of a period.
 *   - clutch: the last CLUTCH_SECONDS of the fourth quarter or an overtime,
 *     with the score within CLUTCH_MARGIN before the play.
 *   - run: every play from a run's first basket to its last, both teams'.
 *   - fast_break: the feed's own qualifier.
 */
export function gameMoments(flow: GameFlow, marks?: GameMarks | null): Map<number, ReadonlySet<GameMoment>> {
  const out = new Map<number, Set<GameMoment>>();
  const add = (eventId: number, moment: GameMoment) => {
    const set = out.get(eventId) ?? new Set<GameMoment>();
    set.add(moment);
    out.set(eventId, set);
  };

  const lengths = new Map<number, number>();
  const lengthOf = (period: number) => {
    let len = lengths.get(period);
    if (len === undefined) {
      len = periodLengthSeconds(flow.order, period);
      lengths.set(period, len);
    }
    return len;
  };

  flow.order.forEach((e, i) => {
    const clock = clockSeconds(e);
    if (clock >= 0) {
      if (clock >= lengthOf(e.period) - EDGE_SECONDS) add(e.eventId, "quarter_start");
      if (clock <= EDGE_SECONDS) add(e.eventId, "quarter_end");
      if (e.period >= 4 && clock <= CLUTCH_SECONDS && flow.scores.length > 0) {
        const before = i === 0 ? { home: 0, away: 0 } : flow.scores[i - 1];
        if (Math.abs(before.home - before.away) <= CLUTCH_MARGIN) add(e.eventId, "clutch");
      }
    }
    if (e.qualifiers?.includes("fastbreak")) add(e.eventId, "fast_break");
  });

  for (const run of flow.runs) {
    const from = flow.indexOf.get(run.fromEventId);
    const to = flow.indexOf.get(run.toEventId);
    if (from === undefined || to === undefined) continue;
    for (let i = from; i <= to; i++) add(flow.order[i].eventId, "run");
  }

  for (const { timeout, eventId } of afterTimeoutPlays(flow, marks)) {
    if (timeout.kind === "team" && eventId !== null) add(eventId, "after_timeout");
  }
  return out;
}

/** A stretch a player is on the floor, inside one period. */
export interface CourtStint {
  period: number;
  team: 1 | 2;
  fromEventId: number;
  toEventId: number;
  /** The score's change for the player's team over the stint; null when the game has no score. */
  plusMinus: number | null;
}

/**
 * When a player was on the floor, from the fives the feed puts on every play.
 * A stint runs from the first play that lists the player to the last before
 * one that doesn't, so it is exact to the gap between two plays; it never
 * crosses a period break. A play with no fives on it (older imports) changes
 * nothing.
 */
export function onCourtStints(flow: GameFlow, personId: number): CourtStint[] {
  const stints: CourtStint[] = [];
  const current: { open: { stint: CourtStint; fromIndex: number; toIndex: number } | null } = { open: null };
  const close = () => {
    if (!current.open) return;
    const { stint, fromIndex, toIndex } = current.open;
    if (flow.scores.length > 0) {
      const before = fromIndex === 0 ? { home: 0, away: 0 } : flow.scores[fromIndex - 1];
      const after = flow.scores[toIndex];
      const change = after.home - after.away - (before.home - before.away);
      stint.plusMinus = stint.team === 1 ? change : -change;
    }
    stints.push(stint);
    current.open = null;
  };
  flow.order.forEach((e, i) => {
    if (current.open && current.open.stint.period !== e.period) close();
    if (!e.onCourtHome && !e.onCourtAway) return;
    const team = e.onCourtHome?.includes(personId) ? 1 : e.onCourtAway?.includes(personId) ? 2 : null;
    if (!team) {
      close();
      return;
    }
    if (current.open && current.open.stint.team === team) {
      current.open.stint.toEventId = e.eventId;
      current.open.toIndex = i;
    } else {
      close();
      current.open = {
        stint: { period: e.period, team, fromEventId: e.eventId, toEventId: e.eventId, plusMinus: null },
        fromIndex: i,
        toIndex: i,
      };
    }
  });
  close();
  return stints;
}

export interface FlowChart {
  /** The score difference as a step line. */
  line: string;
  /** The area where the home side leads (above the zero line). */
  home: string;
  /** The area where the away side leads (below it). */
  away: string;
  zeroY: number;
  /** The lead the top and bottom edges stand for. */
  maxAbs: number;
  yOf: (diff: number) => number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The score-difference chart as SVG paths: geometry only, so any painter
 * draws the same picture. `points` are baskets already placed on the x axis
 * (ascending); the difference holds between them, so the line is stepped. It
 * starts level at `x0` and ends at `x1`. The scale is symmetric, to the
 * largest lead rounded up to five (at least `minScale`).
 */
export function flowChart(input: {
  points: ReadonlyArray<{ x: number; diff: number }>;
  x0: number;
  x1: number;
  height: number;
  /** Room kept clear above and below. */
  pad?: number;
  minScale?: number;
}): FlowChart {
  const { points, x0, x1, height } = input;
  const pad = input.pad ?? 2;
  let largest = 0;
  for (const p of points) largest = Math.max(largest, Math.abs(p.diff));
  const maxAbs = Math.max(input.minScale ?? 10, Math.ceil(largest / 5) * 5);
  const zeroY = round1(height / 2);
  const unit = (height / 2 - pad) / maxAbs;
  const yOf = (diff: number) => round1(height / 2 - diff * unit);

  // The step line's corners.
  const corners: Array<{ x: number; diff: number }> = [{ x: x0, diff: 0 }];
  let prev = 0;
  for (const p of points) {
    const x = round1(Math.min(Math.max(p.x, x0), x1));
    corners.push({ x, diff: prev }, { x, diff: p.diff });
    prev = p.diff;
  }
  corners.push({ x: x1, diff: prev });

  const through = (clamp: (d: number) => number) =>
    corners.map((c, i) => `${i === 0 ? "M" : "L"}${round1(c.x)} ${yOf(clamp(c.diff))}`).join("");
  const line = through((d) => d);
  const home = `${through((d) => Math.max(d, 0))}L${round1(x1)} ${zeroY}L${round1(x0)} ${zeroY}Z`;
  const away = `${through((d) => Math.min(d, 0))}L${round1(x1)} ${zeroY}L${round1(x0)} ${zeroY}Z`;
  return { line, home, away, zeroY, maxAbs, yOf };
}
