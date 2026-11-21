/**
 * A game beside each team's season, for the desktop Stats view (the design:
 * docs/superpowers/specs/2026-11-20-season-context-design.md). The season is
 * the team's other regular-season games, summed and put through the same
 * formula as tonight's numbers (`factorsOf`), so a mark and a bar never
 * disagree because of a definition. A difference is written out only when it
 * is bigger than one game's usual swing explains (`realGap`).
 */
import type { League } from "../types/league";
import type { StoredMatch } from "../types/match";
import {
  FACTOR_KEYS,
  LOWER_IS_BETTER,
  factorsOf,
  type FactorKey,
  type FactorTotals,
  type PointsFrom,
  type TeamFactors,
} from "./game-box";
import type { TeamStanding } from "./season-copy";
import type { SeasonGame, SeasonPayload, SeasonStanding, TeamGame } from "./season-payload";
import { seasonOf, statsKindOf } from "./stats-card-data";

export type { TeamStanding };

/** How many of one game's usual swings a gap must be to be written out. */
export const GAP_SWINGS = 1.5;
/** Other games a team needs before a gap is written out. */
export const MIN_GAP_GAMES = 4;
/** Games a team needs to count towards the league's swing. */
export const MIN_SWING_GAMES = 3;

export interface TeamSeason {
  teamId: number;
  /** Other regular-season games counted. */
  games: number;
  /** The team's own, from its summed totals. */
  factors: TeamFactors;
  /** Its opponents' in those games: what it usually allows. */
  allowed: TeamFactors;
  /** Points from the paint, second chance, fast break, turnovers and bench, a game. */
  perGame: Record<PointsFrom, number | null>;
  /** 1 = best in its group (the standings' poolNumber): the whole competition when it is one table. */
  ranks: Record<FactorKey, number | null>;
  /** Teams of its group with a counted game: what its ranks are "of". */
  of: number;
  standing: TeamStanding | null;
}

export interface SeasonContext {
  home: TeamSeason;
  away: TeamSeason;
  /** Teams with a counted regular-season game: the "of 11". */
  teams: number;
  /** The league's typical single-game swing per factor. */
  swing: Record<FactorKey, number | null>;
  /** Tonight is a regular-season game; else (finals) the whole regular season is the comparison. */
  regular: boolean;
}

/** A Genius team row as factor totals. Its rebounds hold team rebounds and leave dead-ball ones out, as our plays do (checked 2026-11-20). */
export function geniusTotals(g: TeamGame): FactorTotals {
  return { pts: g.pts, fgm: g.fgm, fga: g.fga, tpm: g.tpm, fta: g.fta, oreb: g.oreb, dreb: g.dreb, tov: g.tov };
}

/** A regular-season game (no type given counts as one) with both sides' statistics. */
export const isRegular = (game: SeasonGame) => game.matchType === "REGULAR" || game.matchType === "";
export const counted = (game: SeasonGame): game is SeasonGame & { home: TeamGame; away: TeamGame } =>
  isRegular(game) && !!game.home && !!game.away;

/** One team's side of a game: its row and its opponent's. */
export interface Side {
  matchId: number;
  team: TeamGame;
  opp: TeamGame;
}

/** Every counted game, as each team's sides (season-context and league-season read the same rows). */
export function sidesByTeam(payload: SeasonPayload): Map<number, Side[]> {
  const byTeam = new Map<number, Side[]>();
  const add = (side: Side) => {
    const list = byTeam.get(side.team.teamId) ?? [];
    list.push(side);
    byTeam.set(side.team.teamId, list);
  };
  for (const game of payload.games) {
    if (!counted(game)) continue;
    add({ matchId: game.matchId, team: game.home, opp: game.away });
    add({ matchId: game.matchId, team: game.away, opp: game.home });
  }
  return byTeam;
}

const ZERO: FactorTotals = { pts: 0, fgm: 0, fga: 0, tpm: 0, fta: 0, oreb: 0, dreb: 0, tov: 0 };

export function summed(rows: TeamGame[]): FactorTotals {
  const out = { ...ZERO };
  for (const r of rows) {
    const t = geniusTotals(r);
    for (const k of Object.keys(out) as (keyof FactorTotals)[]) out[k] += t[k];
  }
  return out;
}

const NONE: TeamFactors = { possessions: null, ppp: null, efg: null, tovRate: null, orebPct: null, ftRate: null };

function seasonFactors(sides: Side[]): { factors: TeamFactors; allowed: TeamFactors } {
  if (!sides.length) return { factors: { ...NONE }, allowed: { ...NONE } };
  const own = summed(sides.map((s) => s.team));
  const opp = summed(sides.map((s) => s.opp));
  return { factors: factorsOf(own, opp), allowed: factorsOf(opp, own) };
}

const PER_GAME: Record<PointsFrom, keyof TeamGame> = {
  paint: "paint",
  second_chance: "secondChance",
  fast_break: "fastBreak",
  turnovers: "offTurnovers",
  bench: "bench",
};

export function perGame(sides: Side[]): Record<PointsFrom, number | null> {
  const out = {} as Record<PointsFrom, number | null>;
  for (const [k, field] of Object.entries(PER_GAME) as [PointsFrom, keyof TeamGame][]) {
    out[k] = sides.length ? sides.reduce((n, s) => n + (s.team[field] as number), 0) / sides.length : null;
  }
  return out;
}

export function populationSd(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

/** For each team with enough games, the spread of its single-game values; then the mean over those teams. */
function leagueSwing(byTeam: Map<number, Side[]>): Record<FactorKey, number | null> {
  const out = {} as Record<FactorKey, number | null>;
  for (const k of FACTOR_KEYS) {
    const spreads: number[] = [];
    for (const sides of byTeam.values()) {
      if (sides.length < MIN_SWING_GAMES) continue;
      const values = sides
        .map((s) => factorsOf(geniusTotals(s.team), geniusTotals(s.opp))[k])
        .filter((v): v is number => v !== null);
      if (values.length >= MIN_SWING_GAMES) spreads.push(populationSd(values));
    }
    out[k] = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
  }
  return out;
}

/** 1 = best; ties share a place (1, 2, 2, 4); a team without a value has no rank. */
function rankOf(key: FactorKey, value: number | null, all: (number | null)[]): number | null {
  if (value === null) return null;
  const lower = LOWER_IS_BETTER.has(key);
  return 1 + all.filter((v) => v !== null && (lower ? v < value : v > value)).length;
}

/** A team's standings row: the regular season's, else the first it has. */
export function standingRowOf(payload: SeasonPayload, teamId: number): SeasonStanding | null {
  const rows = payload.standings.filter((s) => s.teamId === teamId);
  return rows.find((s) => s.matchType === "REGULAR") ?? rows[0] ?? null;
}

/** Each team's season beside game `matchId`; null when the season doesn't list the game. */
export function seasonContext(payload: SeasonPayload, matchId: number): SeasonContext | null {
  const tonight = payload.games.find((g) => g.matchId === matchId);
  if (!tonight) return null;

  const byTeam = sidesByTeam(payload);
  const others = (teamId: number) => (byTeam.get(teamId) ?? []).filter((s) => s.matchId !== matchId);
  const tonightIds = new Set([tonight.homeTeamId, tonight.awayTeamId]);

  // What each team is ranked on: tonight's two on their other games, the rest on everything.
  const rankedOn = new Map<number, TeamFactors>();
  for (const [teamId, sides] of byTeam) rankedOn.set(teamId, seasonFactors(tonightIds.has(teamId) ? others(teamId) : sides).factors);
  for (const teamId of tonightIds) if (!rankedOn.has(teamId)) rankedOn.set(teamId, { ...NONE });
  // A team is placed among its own group's teams; without standings every team is in one group.
  const groupOf = (teamId: number) => standingRowOf(payload, teamId)?.poolNumber ?? null;
  const competitorsOf = (teamId: number) =>
    [...byTeam.keys()].filter((id) => groupOf(id) === groupOf(teamId)).map((id) => rankedOn.get(id)!);

  const standingOf = (teamId: number): TeamStanding | null => {
    const row = standingRowOf(payload, teamId);
    return row ? { position: row.position, won: row.won, lost: row.lost, last5: row.last5, streak: row.streak } : null;
  };

  const team = (teamId: number): TeamSeason => {
    const sides = others(teamId);
    const own = rankedOn.get(teamId)!;
    const competitors = competitorsOf(teamId);
    const ranks = {} as Record<FactorKey, number | null>;
    for (const k of FACTOR_KEYS) ranks[k] = rankOf(k, own[k], competitors.map((f) => f[k]));
    return {
      teamId,
      games: sides.length,
      ...seasonFactors(sides),
      perGame: perGame(sides),
      ranks,
      of: competitors.length,
      standing: standingOf(teamId),
    };
  };

  return {
    home: team(tonight.homeTeamId),
    away: team(tonight.awayTeamId),
    teams: byTeam.size,
    swing: leagueSwing(byTeam),
    regular: isRegular(tonight),
  };
}

/** A gap worth writing out: enough other games, and further from the season than one game's swing explains. */
export function realGap(tonight: number | null, season: number | null, swing: number | null, games: number): boolean {
  if (tonight === null || season === null || swing === null || games < MIN_GAP_GAMES) return false;
  return Math.abs(tonight - season) >= GAP_SWINGS * swing;
}

/** How many captions tonight's factors get beside the season: the real gaps on both sides. */
export function seasonGaps(tonight: { home: TeamFactors; away: TeamFactors }, ctx: SeasonContext): number {
  let n = 0;
  for (const side of ["home", "away"] as const) {
    for (const k of FACTOR_KEYS) if (realGap(tonight[side][k], ctx[side].factors[k], ctx.swing[k], ctx[side].games)) n++;
  }
  return n;
}

/** The Genius competition and match a stored game's season comes from; null for any other game. */
export function seasonMatchOf(match: StoredMatch, leagues: League[]): { competitionId: number; matchId: number } | null {
  if (statsKindOf(match) !== "genius") return null;
  const season = seasonOf(match, leagues);
  if (!season) return null;
  return { competitionId: season.competitionId, matchId: Number(match.sourceGameId) };
}
