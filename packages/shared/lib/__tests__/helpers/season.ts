// Builders for season payloads in tests (season-context, league-season, team-keys, team-schedule).
import type { SeasonGame, SeasonPayload, SeasonStanding, TeamGame } from "../../season-payload";

/** A team's game with round numbers; anything can be overridden. */
export function tg(teamId: number, over: Partial<TeamGame> = {}): TeamGame {
  return {
    teamId,
    pts: 80,
    ptsAgainst: 75,
    fgm: 30,
    fga: 65,
    tpm: 8,
    tpa: 25,
    ftm: 12,
    fta: 16,
    oreb: 10,
    dreb: 25,
    orebTeam: 1,
    drebTeam: 1,
    orebDeadball: 0,
    drebDeadball: 0,
    tov: 12,
    tovTeam: 1,
    paint: 30,
    secondChance: 10,
    fastBreak: 8,
    offTurnovers: 12,
    bench: 20,
    ...over,
  };
}

export function g(matchId: number, home: TeamGame | number, away: TeamGame | number, matchType = "REGULAR"): SeasonGame {
  const out: SeasonGame = {
    matchId,
    matchType,
    homeTeamId: typeof home === "number" ? home : home.teamId,
    awayTeamId: typeof away === "number" ? away : away.teamId,
  };
  if (typeof home !== "number") out.home = home;
  if (typeof away !== "number") out.away = away;
  return out;
}

export const payload = (games: SeasonGame[], standings: SeasonStanding[] = []): SeasonPayload => ({ games, standings, fetchedAt: "t" });

/** A regular-season standings row in group `poolNumber`. */
export const st = (teamId: number, poolNumber: number, position = 1): SeasonStanding => ({
  teamId,
  position,
  poolNumber,
  matchType: "REGULAR",
  played: 2,
  won: 1,
  lost: 1,
  last5: "WL",
  streak: "1",
});

export function hasNaN(v: unknown): boolean {
  if (typeof v === "number") return Number.isNaN(v);
  if (v && typeof v === "object") return Object.values(v).some(hasNaN);
  return false;
}
