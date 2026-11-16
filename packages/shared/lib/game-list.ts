/**
 * What the game view's list shows: which plays a set of filters keeps, and
 * the rows the list is made of (a header per period, the markers that fall
 * between plays, the plays themselves). Pure.
 */
import type { GameMarks, GameTimeout } from "../types/game-marks";
import type { PlayByPlayEvent } from "../types/match";
import { EMPTY_CLIP_FILTERS, matchesClipFilters, matchesLabelFilter, type ClipFilters } from "./clip-filters";
import { playerName } from "./events";
import { afterTimeoutPlays, type GameFlow, type GameMoment, type PeriodScore, type Score, type ScoringRun } from "./game-flow";
import type { GameTimeline, TimedPlay } from "./game-timeline";

export interface GameFilters {
  /** 0 = both teams, 1 = home, 2 = away. */
  team: 0 | 1 | 2;
  /** Typed into the search field: a player's name or shirt number. */
  search: string;
  /** One moment at a time. */
  moment: GameMoment | null;
  /** Global periods; empty = every period. */
  periods: ReadonlySet<number>;
  /** Event types, shot types, situations, players and labels: the Add clips vocabulary. */
  clip: ClipFilters;
  /** With a player chosen: every play while that player is on the floor, not only their own. */
  onCourt: boolean;
}

export const EMPTY_GAME_FILTERS: GameFilters = {
  team: 0,
  search: "",
  moment: null,
  periods: new Set(),
  clip: EMPTY_CLIP_FILTERS,
  onCourt: false,
};

/** How many of the filter sheet's groups are narrowing the list (the count on its button). */
export function gameFilterCount(f: GameFilters): number {
  return (
    (f.clip.types.size > 0 ? 1 : 0) +
    (f.clip.shotTypes.size > 0 ? 1 : 0) +
    (f.clip.situations.size > 0 ? 1 : 0) +
    (f.clip.players.size > 0 ? 1 : 0) +
    ((f.clip.labels?.size ?? 0) > 0 ? 1 : 0) +
    (f.periods.size > 0 ? 1 : 0)
  );
}

/** Whether anything narrows the list: a filtered list offers "Add all" and drops the in-between markers. */
export function gameFiltersActive(f: GameFilters): boolean {
  return f.team !== 0 || f.search.trim() !== "" || f.moment !== null || gameFilterCount(f) > 0;
}

function teamOf(e: PlayByPlayEvent): number | null {
  return e.eventTeam?.teamNumber ?? e.player?.teamNumber ?? null;
}

function matchesSearch(e: PlayByPlayEvent, query: string): boolean {
  if (!e.player) return false;
  const number = query.replace(/^#/, "");
  if (/^\d+$/.test(number)) return String(e.player.pno) === number;
  return playerName(e).toLowerCase().includes(query);
}

export interface GameFilterContext {
  /** gameMoments' answer. */
  moments: ReadonlyMap<number, ReadonlySet<GameMoment>>;
  /** The labels on a play, by clip key. */
  labelsOf?: (key: string) => ReadonlySet<string> | undefined;
  /** The plays while the chosen player is on the floor, by eventId; read only while `onCourt` is on. */
  onCourtIds?: ReadonlySet<number> | null;
}

/**
 * The test a play passes to be listed. Groups combine (team and moment and
 * period…); inside a group any chosen value will do. With `onCourt` on and
 * the on-court plays known, the player filter means "while they are on the
 * floor" instead of "their own plays".
 */
export function keepPlay(filters: GameFilters, ctx: GameFilterContext): (play: TimedPlay) => boolean {
  const query = filters.search.trim().toLowerCase();
  const whileOnCourt = filters.onCourt && filters.clip.players.size > 0 && !!ctx.onCourtIds;
  const clip: ClipFilters = whileOnCourt ? { ...filters.clip, players: new Set() } : filters.clip;
  return (play) => {
    const e = play.event;
    if (filters.team !== 0 && teamOf(e) !== filters.team) return false;
    if (filters.periods.size > 0 && !filters.periods.has(e.period)) return false;
    if (filters.moment && !ctx.moments.get(e.eventId)?.has(filters.moment)) return false;
    if (query && !matchesSearch(e, query)) return false;
    if (whileOnCourt && !ctx.onCourtIds!.has(e.eventId)) return false;
    if (!matchesClipFilters(e, clip)) return false;
    return matchesLabelFilter(ctx.labelsOf?.(play.key), filters.clip.labels);
  };
}

export type GameRow =
  /** A period's header: its own score and how many plays are listed under it. */
  | { kind: "period"; key: string; period: number; score: PeriodScore | null; plays: number }
  /** A timeout, where it fell among the plays. */
  | { kind: "timeout"; key: string; timeout: GameTimeout }
  /** A scoring run, above its first basket. */
  | { kind: "run"; key: string; run: ScoringRun }
  /** The end of a period, with the score then: `half` after the second, `final` after the last. */
  | { kind: "period_end"; key: string; period: number; score: Score | null; half: boolean; final: boolean }
  | { kind: "play"; key: string; play: TimedPlay };

/**
 * The list's rows. Unfiltered, the game reads like a scoresheet: every play,
 * with timeouts, runs and period ends where they happened. Filtered, only
 * what matches is listed under its period, and the markers go: except the
 * ones the chosen moment is about, which head their plays (the timeout above
 * the play it led to, the run above its baskets).
 */
export function gameRows(input: {
  timeline: Pick<GameTimeline, "plays" | "timeOf">;
  keep: (play: TimedPlay) => boolean;
  filters: GameFilters;
  flow: GameFlow;
  marks?: GameMarks | null;
}): GameRow[] {
  const { timeline, keep, filters, flow, marks } = input;
  const filtered = gameFiltersActive(filters);
  const rows: GameRow[] = [];

  const byPeriod = new Map<number, TimedPlay[]>();
  for (const play of timeline.plays) {
    if (!keep(play)) continue;
    const list = byPeriod.get(play.event.period) ?? [];
    list.push(play);
    byPeriod.set(play.event.period, list);
  }
  const periods = [...byPeriod.keys()].sort((a, b) => a - b);
  const lastPeriod = flow.order.length > 0 ? Math.max(...flow.order.map((e) => e.period)) : 0;

  // The timeout above the play it led to, for the "after timeouts" list.
  const leadsTo = new Map<number, GameTimeout>();
  if (filters.moment === "after_timeout") {
    for (const { timeout, eventId } of afterTimeoutPlays(flow, marks)) {
      if (eventId !== null && timeout.kind === "team") leadsTo.set(eventId, timeout);
    }
  }
  const showRuns = !filtered || filters.moment === "run";
  const runStarts = new Map<number, ScoringRun>();
  if (showRuns) for (const run of flow.runs) runStarts.set(run.fromEventId, run);

  for (const period of periods) {
    const plays = byPeriod.get(period)!;
    rows.push({
      kind: "period",
      key: `period:${period}`,
      period,
      score: flow.periods.find((p) => p.period === period) ?? null,
      plays: plays.length,
    });

    // Unfiltered, every timeout of the period sits before the first play after it.
    const timeouts = filtered
      ? []
      : (marks?.timeouts ?? [])
          .filter((t) => t.period === period)
          .map((timeout) => ({ timeout, time: timeline.timeOf(timeout.realWorldTime, period) }));
    let nextTimeout = 0;
    const isBefore = (t: { timeout: GameTimeout; time: number | null }, play: TimedPlay) =>
      t.time !== null ? t.time <= play.time : t.timeout.eventId < play.event.eventId;

    for (const play of plays) {
      while (nextTimeout < timeouts.length && isBefore(timeouts[nextTimeout], play)) {
        const { timeout } = timeouts[nextTimeout++];
        rows.push({ kind: "timeout", key: `timeout:${timeout.eventId}`, timeout });
      }
      const led = leadsTo.get(play.event.eventId);
      if (led) rows.push({ kind: "timeout", key: `timeout:${led.eventId}`, timeout: led });
      const run = runStarts.get(play.event.eventId);
      if (run) rows.push({ kind: "run", key: `run:${run.fromEventId}`, run });
      rows.push({ kind: "play", key: play.key, play });
    }
    while (nextTimeout < timeouts.length) {
      const { timeout } = timeouts[nextTimeout++];
      rows.push({ kind: "timeout", key: `timeout:${timeout.eventId}`, timeout });
    }

    if (!filtered) {
      const total = flow.periods.find((p) => p.period === period);
      rows.push({
        kind: "period_end",
        key: `end:${period}`,
        period,
        score: total ? { home: total.homeTotal, away: total.awayTotal } : null,
        half: period === 2 && lastPeriod > 2,
        final: period === lastPeriod,
      });
    }
  }
  return rows;
}
