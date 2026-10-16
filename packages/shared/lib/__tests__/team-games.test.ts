import { describe, expect, it } from "vitest";
import {
  fromTeamSide,
  latestToImport,
  stageForMatchType,
  teamGames,
  teamSeasonLabel,
  teamSeasons,
  type TeamSource,
} from "../team-games";
import type { ScheduleGame } from "../genius";
import { PLAYOFF, REGULAR, type League } from "../../types/league";

const league = (id: string, name: string, seasons: [string, string, number?][]): League => ({
  id,
  name,
  country: "SE",
  seasons: seasons.map(([sid, label, competitionId]) => ({ id: sid, label, competitionId, stages: [REGULAR, PLAYOFF] })),
});

const leagues = [
  league("superettan-herr", "Superettan Herr", [["2026-27", "2026/27", 49176], ["2025-26", "2025/26", 42132]]),
  league("basketettan-herr", "Basketettan Herr", [["2026-27", "2026/27", 50039], ["2025-26", "2025/26", 42251]]),
];

const src = (sourceTeamId: string, leagueId: string, seasonId: string, source = "genius"): TeamSource => ({
  source,
  sourceTeamId,
  leagueId,
  seasonId,
});

const game = (
  uuid: string,
  date: string,
  home: [string, string, number],
  away: [string, string, number],
  matchType = "REGULAR",
): ScheduleGame => {
  const side = ([teamId, name, score]: [string, string, number]) => ({
    teamId,
    names: { short: name, long: name },
    score,
    icon: `https://img/${teamId}.png`,
    status: "COMPLETE",
  });
  return {
    uuid,
    rawStartDateTime: date,
    startDateTime: date,
    homeTeamInfo: side(home),
    awayTeamInfo: side(away),
    venueInfo: { name: "Hall" },
    matchType,
  };
};

const ours = new Set(["sol"]);
const home = game("g1", "2026-10-04T15:00:00Z", ["sol", "Sollentuna Basket", 84], ["aik", "AIK", 77]);
const away = game("g2", "2026-09-27T15:00:00Z", ["dif", "Djurgården", 81], ["sol", "Sollentuna Basket", 70]);
const playoff = game("g3", "2026-10-11T15:00:00Z", ["nor", "Norrort", 88], ["sol", "Sollentuna Basket", 91], "FINALS");
const other = game("g4", "2026-10-05T15:00:00Z", ["aik", "AIK", 60], ["dif", "Djurgården", 62]);

describe("teamSeasons", () => {
  it("lists the seasons the team played, newest first, across a promotion", () => {
    const seasons = teamSeasons(
      [src("old", "basketettan-herr", "2025-26"), src("sol", "superettan-herr", "2026-27")],
      leagues,
    );
    expect(seasons.map((s) => `${s.league.id}/${s.season.id}`)).toEqual([
      "superettan-herr/2026-27",
      "basketettan-herr/2025-26",
    ]);
    expect([...seasons[0].teamIds]).toEqual(["sol"]);
    expect(teamSeasonLabel(seasons[1])).toBe("2025/26 · Basketettan Herr");
  });

  it("drops seasons the catalogue doesn't carry and other sources", () => {
    const seasons = teamSeasons(
      [src("a", "superettan-herr", "2019-20"), src("b", "sbl-herr", "2026-27"), src("c", "superettan-herr", "2026-27", "profixio")],
      leagues,
    );
    expect(seasons).toEqual([]);
  });

  it("drops seasons without a Genius competition", () => {
    const noComp = [league("superettan-herr", "Superettan Herr", [["2026-27", "2026/27"]])];
    expect(teamSeasons([src("sol", "superettan-herr", "2026-27")], noComp)).toEqual([]);
  });
});

describe("fromTeamSide", () => {
  it("reads a home win with our score first", () => {
    expect(fromTeamSide(home, ours)).toMatchObject({
      isHome: true,
      opponent: { name: "AIK", icon: "https://img/aik.png" },
      ours: 84,
      theirs: 77,
      result: "W",
      playoff: false,
    });
  });

  it("reads an away loss from our side", () => {
    expect(fromTeamSide(away, ours)).toMatchObject({ isHome: false, opponent: { name: "Djurgården" }, ours: 70, theirs: 81, result: "L" });
  });

  it("tags playoff games and ignores games we didn't play", () => {
    expect(fromTeamSide(playoff, ours)?.playoff).toBe(true);
    expect(fromTeamSide(other, ours)).toBeNull();
  });

  it("calls an equal score a tie", () => {
    const tie = game("g5", "2026-10-01T15:00:00Z", ["sol", "Sollentuna Basket", 70], ["aik", "AIK", 70]);
    expect(fromTeamSide(tie, ours)?.result).toBe("T");
  });
});

describe("teamGames and latestToImport", () => {
  const games = teamGames([away, other, home, playoff], ours);

  it("keeps our games, newest first", () => {
    expect(games.map((g) => g.game.uuid)).toEqual(["g3", "g1", "g2"]);
  });

  it("offers the newest game not imported yet", () => {
    expect(latestToImport(games, new Set())?.game.uuid).toBe("g3");
    expect(latestToImport(games, new Set(["g3"]))?.game.uuid).toBe("g1");
    expect(latestToImport(games, new Set(["g1", "g2", "g3"]))).toBeNull();
  });
});

describe("stageForMatchType", () => {
  const season = leagues[0].seasons[0];
  it("maps a game's match type to the season's stage", () => {
    expect(stageForMatchType(season, "FINALS")?.id).toBe("playoff");
    expect(stageForMatchType(season, "REGULAR")?.id).toBe("regular");
    expect(stageForMatchType(season, undefined)?.id).toBe("regular");
  });
});
