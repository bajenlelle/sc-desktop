/**
 * A game's box score, counted from its stored plays: what the desktop's Stats
 * view shows (docs/game-view.md, "Stats"). Every number carries the plays it
 * stands for, so a click on it opens exactly those plays in the Game view and
 * the two can never disagree.
 *
 * Counting rules (docs/play-by-play-data-inventory.md):
 * - Points: made 2pt = 2, 3pt = 3, free throw = 1.
 * - `isSuccessful` means made or missed for the three shot types only.
 * - A row with no player is a team stat (team rebounds and turnovers),
 *   credited to `eventTeam`.
 * - The `offensivedeadball` inbound marker is bookkeeping and counts nowhere.
 */
import type { PlayByPlayEvent } from "../types/match";
import { isBookkeepingEvent, playerName } from "./events";
import { gameOrder } from "./game-flow";

export type BoxStat = "pts" | "fg" | "tp" | "ft" | "oreb" | "dreb" | "reb" | "ast" | "tov" | "stl" | "blk" | "pf";

export const BOX_STATS: readonly BoxStat[] = ["pts", "fg", "tp", "ft", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf"];

/** A number and the plays it stands for. Shooting cells: value = makes, attempts = eventIds.length. */
export interface BoxCell {
  value: number;
  attempts?: number;
  eventIds: readonly number[];
}

export interface BoxPlayer {
  personId: number;
  name: string;
  number: string;
  side: 1 | 2;
  starter: boolean;
  cells: Record<BoxStat, BoxCell>;
}

type TeamRowStat = "oreb" | "dreb" | "reb" | "tov";

export interface BoxTeam {
  side: 1 | 2;
  players: BoxPlayer[];
  /** Team rebounds and turnovers: rows with no player. */
  teamRow: Pick<Record<BoxStat, BoxCell>, TeamRowStat>;
  totals: Record<BoxStat, BoxCell>;
}

export interface GameBox {
  home: BoxTeam;
  away: BoxTeam;
  /** Some play lists the five on the floor (Genius imports since September 2026). */
  hasFives: boolean;
  /** Some shot was missed: a source that records misses. */
  hasMisses: boolean;
  /** The first five on the floor per side, by personId; empty without fives. Includes starters with no play of their own. */
  starters: { home: readonly number[]; away: readonly number[] };
}

/** What a player's set of plays is called, after their name. */
export const STAT_WORDS: Record<BoxStat, string> = {
  pts: "points",
  fg: "shots",
  tp: "three-point attempts",
  ft: "free throws",
  oreb: "offensive rebounds",
  dreb: "defensive rebounds",
  reb: "rebounds",
  ast: "assists",
  tov: "turnovers",
  stl: "steals",
  blk: "blocks",
  pf: "fouls",
};

/** "Lind: three-point attempts". */
export function statSetName(who: string, stat: BoxStat): string {
  return `${who}: ${STAT_WORDS[stat]}`;
}

const SHOOTING: ReadonlySet<BoxStat> = new Set(["fg", "tp", "ft"]);

interface Tally {
  value: number;
  attempts: number;
  ids: number[];
}
type Tallies = Record<BoxStat, Tally>;

function tallies(): Tallies {
  const t = {} as Tallies;
  for (const s of BOX_STATS) t[s] = { value: 0, attempts: 0, ids: [] };
  return t;
}

function cellOf(stat: BoxStat, t: Tally): BoxCell {
  return SHOOTING.has(stat) ? { value: t.value, attempts: t.attempts, eventIds: t.ids } : { value: t.value, eventIds: t.ids };
}

function cells(t: Tallies): Record<BoxStat, BoxCell> {
  const out = {} as Record<BoxStat, BoxCell>;
  for (const s of BOX_STATS) out[s] = cellOf(s, t[s]);
  return out;
}

const count = (t: Tally, id: number, by = 1) => {
  t.value += by;
  t.ids.push(id);
};

/** What one play adds to a line. */
function addPlay(t: Tallies, e: PlayByPlayEvent): void {
  const id = e.eventId;
  const made = e.isSuccessful === 1;
  const sub = e.subType?.toLowerCase() ?? "";
  switch (e.type) {
    case "2pt":
    case "3pt": {
      t.fg.attempts++;
      t.fg.ids.push(id);
      if (e.type === "3pt") {
        t.tp.attempts++;
        t.tp.ids.push(id);
      }
      if (made) {
        t.fg.value++;
        if (e.type === "3pt") t.tp.value++;
        count(t.pts, id, e.type === "3pt" ? 3 : 2);
      }
      break;
    }
    case "freethrow":
      t.ft.attempts++;
      t.ft.ids.push(id);
      if (made) {
        t.ft.value++;
        count(t.pts, id, 1);
      }
      break;
    case "rebound":
      if (sub.includes("off")) count(t.oreb, id);
      else if (sub.includes("def")) count(t.dreb, id);
      count(t.reb, id);
      break;
    case "assist":
      count(t.ast, id);
      break;
    case "turnover":
      count(t.tov, id);
      break;
    case "steal":
      count(t.stl, id);
      break;
    case "block":
      count(t.blk, id);
      break;
    case "foul":
      count(t.pf, id);
      break;
  }
}

function sideOf(e: PlayByPlayEvent): 1 | 2 | null {
  const n = e.player?.teamNumber ?? e.eventTeam?.teamNumber;
  return n === 1 || n === 2 ? n : null;
}

const isShot = (e: PlayByPlayEvent) => e.type === "2pt" || e.type === "3pt" || e.type === "freethrow";

// ---------------------------------------------------------------------------
// Team factors (Dean Oliver's four, and points per possession)
// ---------------------------------------------------------------------------

export interface TeamFactors {
  /** FGA − OREB + TO + 0.44 × FTA; null when the source records no misses (every factor is then null too). */
  possessions: number | null;
  /** Points per possession. */
  ppp: number | null;
  /** (FGM + 0.5 × 3PM) ÷ FGA. */
  efg: number | null;
  /** TO ÷ possessions. */
  tovRate: number | null;
  /** OREB ÷ (OREB + the other team's DREB), team rebounds counted. */
  orebPct: number | null;
  /** FTA ÷ FGA. */
  ftRate: number | null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function teamFactors(box: GameBox): { home: TeamFactors; away: TeamFactors } {
  // A source that logs made baskets only (Profixio) has FGA = FGM: every factor would be invented.
  if (!box.hasMisses) {
    const none: TeamFactors = { possessions: null, ppp: null, efg: null, tovRate: null, orebPct: null, ftRate: null };
    return { home: none, away: { ...none } };
  }
  const of = (t: BoxTeam, other: BoxTeam): TeamFactors => {
    const c = t.totals;
    const fga = c.fg.attempts ?? 0;
    const fta = c.ft.attempts ?? 0;
    const possessions = Math.max(0, fga - c.oreb.value + c.tov.value + 0.44 * fta);
    return {
      possessions,
      ppp: ratio(c.pts.value, possessions),
      efg: ratio(c.fg.value + 0.5 * c.tp.value, fga),
      tovRate: ratio(c.tov.value, possessions),
      orebPct: ratio(c.oreb.value, c.oreb.value + other.totals.dreb.value),
      ftRate: ratio(fta, fga),
    };
  };
  return { home: of(box.home, box.away), away: of(box.away, box.home) };
}

// ---------------------------------------------------------------------------
// Where the points came from, and points by quarter
// ---------------------------------------------------------------------------

export type PointsFrom = "paint" | "second_chance" | "fast_break" | "turnovers" | "bench";

export const POINTS_FROM: readonly PointsFrom[] = ["paint", "second_chance", "fast_break", "turnovers", "bench"];

const QUALIFIER: Record<Exclude<PointsFrom, "bench">, string> = {
  paint: "pointsinthepaint",
  second_chance: "2ndchance",
  fast_break: "fastbreak",
  turnovers: "fromturnover",
};

function pointsOf(e: PlayByPlayEvent): number {
  if (e.isSuccessful !== 1) return 0;
  return e.type === "3pt" ? 3 : e.type === "2pt" ? 2 : e.type === "freethrow" ? 1 : 0;
}

/** Points by side over the plays `keep` lets through, each with its scoring plays. */
function sidePoints(events: readonly PlayByPlayEvent[], keep: (e: PlayByPlayEvent) => boolean): { home: BoxCell; away: BoxCell } {
  const out = { 1: { value: 0, ids: [] as number[] }, 2: { value: 0, ids: [] as number[] } };
  for (const e of gameOrder(events).order) {
    const pts = pointsOf(e);
    const side = sideOf(e);
    if (!pts || !side || isBookkeepingEvent(e) || !keep(e)) continue;
    out[side].value += pts;
    out[side].ids.push(e.eventId);
  }
  return { home: { value: out[1].value, eventIds: out[1].ids }, away: { value: out[2].value, eventIds: out[2].ids } };
}

/** A figure is null when the game can't tell it (no fives for bench, no play anywhere with its qualifier for the rest). */
export function pointsFrom(
  events: readonly PlayByPlayEvent[],
  box: GameBox,
): Record<PointsFrom, { home: BoxCell; away: BoxCell } | null> {
  const has = (e: PlayByPlayEvent, q: string) => e.qualifiers?.includes(q) ?? false;
  // A feed that never marks a qualifier can't tell its figure: 0–0 would be a claim.
  const marked = (q: string) => (events.some((e) => has(e, q)) ? sidePoints(events, (e) => has(e, q)) : null);
  const starters = new Set([...box.starters.home, ...box.starters.away]);
  return {
    paint: marked(QUALIFIER.paint),
    second_chance: marked(QUALIFIER.second_chance),
    fast_break: marked(QUALIFIER.fast_break),
    turnovers: marked(QUALIFIER.turnovers),
    bench: box.hasFives ? sidePoints(events, (e) => !!e.player && !starters.has(e.player.playerId)) : null,
  };
}

export interface QuarterCell {
  period: number;
  home: BoxCell;
  away: BoxCell;
}

/** Each period's points per side, overtimes included, in period order. */
export function quarterPoints(events: readonly PlayByPlayEvent[]): QuarterCell[] {
  const periods = [...new Set(events.map((e) => e.period))].sort((a, b) => a - b);
  return periods.map((period) => ({ period, ...sidePoints(events, (e) => e.period === period) }));
}

/** The game's box score from its plays. */
export function gameBox(events: readonly PlayByPlayEvent[]): GameBox {
  const { order } = gameOrder(events);
  const people = new Map<number, { side: 1 | 2; name: string; number: string; t: Tallies }>();
  const teamRows: Record<1 | 2, Tallies> = { 1: tallies(), 2: tallies() };
  const starters: Record<1 | 2, number[]> = { 1: [], 2: [] };
  let hasFives = false;
  let hasMisses = false;

  for (const e of order) {
    if (!starters[1].length && e.onCourtHome?.length) starters[1] = [...e.onCourtHome];
    if (!starters[2].length && e.onCourtAway?.length) starters[2] = [...e.onCourtAway];
    if (e.onCourtHome?.length || e.onCourtAway?.length) hasFives = true;
    if (isBookkeepingEvent(e)) continue;
    if (isShot(e) && e.isSuccessful === 0) hasMisses = true;
    const side = sideOf(e);
    if (!side) continue;
    if (!e.player) {
      if (e.type === "rebound" || e.type === "turnover") addPlay(teamRows[side], e);
      continue;
    }
    let person = people.get(e.player.playerId);
    if (!person) {
      person = { side, name: playerName(e), number: String(e.player.pno ?? ""), t: tallies() };
      people.set(e.player.playerId, person);
    }
    addPlay(person.t, e);
  }

  const team = (side: 1 | 2): BoxTeam => {
    const startSet = new Set(starters[side]);
    const players: BoxPlayer[] = [...people.entries()]
      .filter(([, p]) => p.side === side)
      .map(([personId, p]) => ({ personId, name: p.name, number: p.number, side, starter: startSet.has(personId), cells: cells(p.t) }))
      .sort(
        (a, b) =>
          Number(b.starter) - Number(a.starter) ||
          b.cells.pts.value - a.cells.pts.value ||
          a.name.localeCompare(b.name),
      );
    const row = teamRows[side];
    const totals = tallies();
    for (const t of [...players.map((p) => p.cells), cells(row)]) {
      for (const s of BOX_STATS) {
        totals[s].value += t[s].value;
        totals[s].attempts += t[s].attempts ?? 0;
        totals[s].ids.push(...t[s].eventIds);
      }
    }
    return {
      side,
      players,
      teamRow: { oreb: cellOf("oreb", row.oreb), dreb: cellOf("dreb", row.dreb), reb: cellOf("reb", row.reb), tov: cellOf("tov", row.tov) },
      totals: cells(totals),
    };
  };

  return { home: team(1), away: team(2), hasFives, hasMisses, starters: { home: starters[1], away: starters[2] } };
}
