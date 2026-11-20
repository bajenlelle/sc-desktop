// The `genius` function's `season` answer: a competition's per-game team rows
// from Genius (`/statistics/teammatch/competitions/{c}`), trimmed and put on
// each fixture's home or away side, plus the standings. What the desktop's
// Stats view compares a game with (season-context.ts; the design is
// docs/superpowers/specs/2026-11-20-season-context-design.md).
//
// No I/O and no imports: the Deno function imports this file directly.

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

/** One team's whole game, overtime included. Rebounds and turnovers include the team ones; the team and dead-ball counts are kept apart too. */
export interface TeamGame {
  teamId: number;
  pts: number;
  ptsAgainst: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  orebTeam: number;
  drebTeam: number;
  orebDeadball: number;
  drebDeadball: number;
  tov: number;
  tovTeam: number;
  paint: number;
  secondChance: number;
  fastBreak: number;
  offTurnovers: number;
  bench: number;
}

/** A fixture, with each side's row once Genius has built the game's statistics. */
export interface SeasonGame {
  matchId: number;
  /** "REGULAR", "FINALS", … as the fixture list gives it; "" when absent. */
  matchType: string;
  homeTeamId: number;
  awayTeamId: number;
  home?: TeamGame;
  away?: TeamGame;
}

export interface SeasonStanding {
  teamId: number;
  /** The place within the team's own pool, as Genius gives it. */
  position: number;
  poolNumber: number | null;
  matchType: string;
  played: number;
  won: number;
  lost: number;
  /** "LWWLW", oldest first; "" when absent. */
  last5: string;
  /** "3" for three wins in a row, "-2" for two losses; "" when absent. */
  streak: string;
}

export interface SeasonPayload {
  games: SeasonGame[];
  standings: SeasonStanding[];
  fetchedAt: string;
  /** Every fixture has been played: the season won't change, so the function keeps it for long. */
  complete?: boolean;
}

const FIELDS: Record<Exclude<keyof TeamGame, "teamId">, string> = {
  pts: "sPoints",
  ptsAgainst: "sPointsAgainst",
  fgm: "sFieldGoalsMade",
  fga: "sFieldGoalsAttempted",
  tpm: "sThreePointersMade",
  tpa: "sThreePointersAttempted",
  ftm: "sFreeThrowsMade",
  fta: "sFreeThrowsAttempted",
  oreb: "sReboundsOffensive",
  dreb: "sReboundsDefensive",
  orebTeam: "sReboundsTeamOffensive",
  drebTeam: "sReboundsTeamDefensive",
  orebDeadball: "sReboundsOffensiveDeadball",
  drebDeadball: "sReboundsDefensiveDeadball",
  tov: "sTurnovers",
  tovTeam: "sTurnoversTeam",
  paint: "sPointsInThePaint",
  secondChance: "sPointsSecondChance",
  fastBreak: "sPointsFastBreak",
  offTurnovers: "sPointsFromTurnovers",
  bench: "sBenchPoints",
};

const num = (v: unknown): number => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? 0 : n;
};

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** A Genius teammatch row → the fields the season reads. */
export function trimTeamGame(row: Json): TeamGame {
  const g = { teamId: num(row.teamId) } as TeamGame;
  for (const [key, field] of Object.entries(FIELDS)) g[key as keyof typeof FIELDS] = num(row[field]);
  return g;
}

function trimStanding(s: Json): SeasonStanding {
  return {
    teamId: num(s.teamId),
    position: num(s.position),
    poolNumber: s.poolNumber === null || s.poolNumber === undefined ? null : num(s.poolNumber),
    matchType: text(s.matchType),
    played: num(s.played),
    won: num(s.won),
    lost: num(s.lost),
    last5: text(s.last5),
    streak: text(s.streak),
  };
}

/**
 * The season answer from Genius's raw teammatch rows, the raw fixture list and
 * the raw standings. Only whole-game rows (`periodType` REGULAR, `periodNumber` 0) are kept; every
 * fixture with one home and one away competitor becomes a game, with or
 * without rows; a row whose game isn't a fixture is dropped.
 */
export function seasonPayload(teamRows: Json[], fixtures: Json[], standings: Json[], fetchedAt: string): SeasonPayload {
  const rows = new Map<string, TeamGame>();
  for (const r of teamRows) {
    if (r.periodType !== "REGULAR" || r.periodNumber === null || r.periodNumber === undefined || num(r.periodNumber) !== 0) continue;
    rows.set(`${num(r.matchId)}:${num(r.teamId)}`, trimTeamGame(r));
  }

  const games: SeasonGame[] = [];
  for (const f of fixtures) {
    const competitors: Json[] = Array.isArray(f.competitors) ? f.competitors : [];
    const homes = competitors.filter((c) => num(c.isHomeCompetitor) === 1);
    const aways = competitors.filter((c) => num(c.isHomeCompetitor) !== 1);
    if (homes.length !== 1 || aways.length !== 1) continue;
    const matchId = num(f.matchId);
    const homeTeamId = num(homes[0].teamId);
    const awayTeamId = num(aways[0].teamId);
    const game: SeasonGame = { matchId, matchType: text(f.matchType), homeTeamId, awayTeamId };
    const home = rows.get(`${matchId}:${homeTeamId}`);
    const away = rows.get(`${matchId}:${awayTeamId}`);
    if (home) game.home = home;
    if (away) game.away = away;
    games.push(game);
  }

  const complete = fixtures.length > 0 && fixtures.every((f) => f.matchStatus === "COMPLETE");
  return { games, standings: standings.map(trimStanding), fetchedAt, complete };
}
