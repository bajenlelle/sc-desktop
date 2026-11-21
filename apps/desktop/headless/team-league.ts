/**
 * A made-up league for the Teams specs (P-teams): six teams, Alfa to Zeta,
 * standing 1st to 6th, each with six regular-season games played and one game
 * still to play (Alfa at Beta, a week from now). Every number is alike except
 * that Alfa takes 45 of its 65 shots from three, so it has exactly one key.
 * Match ids start at 9,000,001, so nothing real is ever asked for.
 */
import type { GeniusFixture } from "@scoutable/shared/lib/genius";
import type { SeasonGame, SeasonPayload, SeasonStanding, TeamGame } from "@scoutable/shared/lib/season-payload";

export const TEAM_NAMES = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];

export interface MadeUpLeague {
  season: SeasonPayload;
  fixtures: GeniusFixture[];
}

function row(teamId: number): TeamGame {
  return {
    teamId, pts: 80, ptsAgainst: 80, fgm: 30, fga: 65, tpm: 8, tpa: teamId === 1 ? 45 : 20, ftm: 12, fta: 16, oreb: 10, dreb: 25,
    orebTeam: 1, drebTeam: 1, orebDeadball: 0, drebDeadball: 0, tov: 12, tovTeam: 1,
    paint: 30, secondChance: 10, fastBreak: 8, offTurnovers: 12, bench: 20,
  };
}

/** "YYYY-MM-DD HH:MM:SS", bare UTC as Genius writes it. */
const geniusTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** The circle method's five rounds for six teams, then the first again: six games each. */
function rounds(): [number, number][][] {
  const ids = [1, 2, 3, 4, 5, 6];
  const out: [number, number][][] = [];
  for (let r = 0; r < 5; r++) {
    const order = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + r) % 5)])];
    out.push([0, 1, 2].map((i) => [order[i], order[5 - i]] as [number, number]));
  }
  return [...out, out[0]];
}

export function madeUpLeague(opts: { groups?: Record<string, number[]>; gamesEach?: number; libraryGame?: number } = {}): MadeUpLeague {
  const groupOf = (teamId: number): { pool: number; name: string } => {
    if (!opts.groups) return { pool: 1, name: "Made-up League" };
    const names = Object.keys(opts.groups);
    const i = names.findIndex((n) => opts.groups![n].includes(teamId));
    return { pool: i + 1, name: names[i] };
  };

  const games: SeasonGame[] = [];
  const fixtures: GeniusFixture[] = [];
  let matchId = 9_000_001;
  const played = rounds().slice(0, opts.gamesEach ?? 6);
  played.forEach((pairs, r) => {
    for (const [home, away] of pairs) {
      const id = opts.libraryGame && home === 1 && r === 0 ? opts.libraryGame : matchId++;
      games.push({ matchId: id, matchType: "REGULAR", homeTeamId: home, awayTeamId: away, home: row(home), away: row(away) });
      const at = new Date(Date.UTC(2026, 9, 1 + 7 * r, 17));
      fixtures.push(fixture(id, home, away, at, "COMPLETE", ["82", "78"], groupOf(home)));
    }
  });
  const ahead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const upcoming = matchId++;
  games.push({ matchId: upcoming, matchType: "REGULAR", homeTeamId: 2, awayTeamId: 1 });
  fixtures.push(fixture(upcoming, 2, 1, ahead, "SCHEDULED", ["", ""], groupOf(2)));

  const standings: SeasonStanding[] = TEAM_NAMES.map((_, i) => ({
    teamId: i + 1,
    position: opts.groups ? opts.groups[groupOf(i + 1).name].indexOf(i + 1) + 1 : i + 1,
    poolNumber: groupOf(i + 1).pool,
    matchType: "REGULAR",
    played: played.length,
    won: played.length - i,
    lost: i,
    last5: "WLWLW",
    streak: "1",
  }));

  return { season: { games, standings, fetchedAt: new Date().toISOString() }, fixtures };
}

function fixture(
  matchId: number,
  home: number,
  away: number,
  at: Date,
  matchStatus: string,
  scores: [string, string],
  group: { pool: number; name: string },
): GeniusFixture {
  return {
    matchId,
    matchTimeUTC: geniusTime(at),
    matchStatus,
    matchType: "REGULAR",
    statsSource: matchStatus === "COMPLETE" ? "FIBA.LiveStats" : "",
    venueName: "",
    phaseName: group.name,
    poolNumber: group.pool,
    competitors: [
      { teamId: home, teamName: TEAM_NAMES[home - 1], scoreString: scores[0], isHomeCompetitor: 1, logoUrl: "" },
      { teamId: away, teamName: TEAM_NAMES[away - 1], scoreString: scores[1], isHomeCompetitor: 0, logoUrl: "" },
    ],
  };
}
