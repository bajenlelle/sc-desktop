/**
 * What the game view's list shows: which plays a set of filters keeps, and
 * the rows the list is made of (a header per period, the markers that fall
 * between plays, the plays themselves). Pure.
 */
import type { GameMarks, GameTimeout } from "../types/game-marks";
import type { PlayByPlayEvent } from "../types/match";
import { EMPTY_CLIP_FILTERS, matchesClipFilters, matchesLabelFilter, type ClipFilters } from "./clip-filters";
import { playerName } from "./events";
import type { GameFlow, GameMoment, PeriodScore, Score, ScoringRun } from "./game-flow";
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
  /** The plays behind a number in the Stats view, by name ("Lind: three-point attempts"); combines with the rest. */
  picked: PickedPlays | null;
}

/** A named set of plays: what a number in the Stats view stands for. */
export interface PickedPlays {
  name: string;
  eventIds: ReadonlySet<number>;
}

export const EMPTY_GAME_FILTERS: GameFilters = {
  team: 0,
  search: "",
  moment: null,
  periods: new Set(),
  clip: EMPTY_CLIP_FILTERS,
  onCourt: false,
  picked: null,
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

/** Whether anything narrows the list: a filtered list offers "Add all", and heads a run only when it is filtered to runs. */
export function gameFiltersActive(f: GameFilters): boolean {
  return f.team !== 0 || f.search.trim() !== "" || f.moment !== null || f.picked !== null || gameFilterCount(f) > 0;
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
    if (filters.picked && !filters.picked.eventIds.has(e.eventId)) return false;
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
 * the plays that match are listed, and the game's frame stays around them:
 * every period of the game keeps its header, its timeouts where they fell
 * among the plays left, and its end, also a period with no play listed. A
 * coach looking at the made twos still sees every timeout and the final
 * score. Only a period filter takes periods away, and a filter nothing
 * matches lists nothing (the list says so instead). A run is headed only when
 * every one of its baskets is there to stand under it: unfiltered, or
 * filtered to runs.
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
  /** Every period the game has a play in. */
  const played = new Set<number>();
  for (const play of timeline.plays) {
    played.add(play.event.period);
    if (!keep(play)) continue;
    const list = byPeriod.get(play.event.period) ?? [];
    list.push(play);
    byPeriod.set(play.event.period, list);
  }
  if (byPeriod.size === 0) return rows;
  const periods = [...played].filter((p) => filters.periods.size === 0 || filters.periods.has(p)).sort((a, b) => a - b);
  const lastPeriod = flow.order.length > 0 ? Math.max(...flow.order.map((e) => e.period)) : 0;

  const showRuns = !filtered || filters.moment === "run";
  const runStarts = new Map<number, ScoringRun>();
  if (showRuns) for (const run of flow.runs) runStarts.set(run.fromEventId, run);

  for (const period of periods) {
    const plays = byPeriod.get(period) ?? [];
    rows.push({
      kind: "period",
      key: `period:${period}`,
      period,
      score: flow.periods.find((p) => p.period === period) ?? null,
      plays: plays.length,
    });

    // Every timeout of the period sits before the first listed play after it, filtered or not: under
    // "after timeouts" that is the play it led to.
    const timeouts = (marks?.timeouts ?? [])
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
      const run = runStarts.get(play.event.eventId);
      if (run) rows.push({ kind: "run", key: `run:${run.fromEventId}`, run });
      rows.push({ kind: "play", key: play.key, play });
    }
    while (nextTimeout < timeouts.length) {
      const { timeout } = timeouts[nextTimeout++];
      rows.push({ kind: "timeout", key: `timeout:${timeout.eventId}`, timeout });
    }

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
  return rows;
}
