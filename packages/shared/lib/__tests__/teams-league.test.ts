import { describe, expect, it } from "vitest";
import type { League } from "../../types/league";
import { leagueChoices, pickTeamsLeague } from "../teams-league";

const league = (id: string, name: string, seasons: [string, number | undefined][], provider?: "profixio"): League => ({
  id,
  name,
  country: "SE",
  seasons: seasons.map(([sid, competitionId]) => ({ id: sid, label: sid.replace("-", "/"), competitionId, stages: [], provider })),
});

const leagues = [
  league("sbl-herr", "SBL Herr", [["2026-27", 48974], ["2025-26", 41539]]),
  league("superettan-herr", "Superettan Herr", [["2026-27", 49176]]),
  league("nt", "National team", [["2026", undefined]]),
  league("zweite", "Zweite Liga", [["2026-27", 7]], "profixio"),
];

describe("leagueChoices", () => {
  it("offers each league's current season that has a Genius competition", () => {
    expect(leagueChoices(leagues).map((c) => [c.leagueId, c.seasonId, c.competitionId, c.label])).toEqual([
      ["sbl-herr", "2026-27", 48974, "SBL Herr · 2026/27"],
      ["superettan-herr", "2026-27", 49176, "Superettan Herr · 2026/27"],
    ]);
  });
});

describe("pickTeamsLeague", () => {
  const c = leagueChoices(leagues);
  const none = { remembered: null, myTeam: null, newestGameLeagueId: null };

  it("opens on the remembered league first", () => {
    expect(pickTeamsLeague(c, { ...none, remembered: "superettan-herr/2026-27", myTeam: { leagueId: "sbl-herr", seasonId: "2026-27" } })!.leagueId).toBe(
      "superettan-herr",
    );
  });

  it("then on the space's team's league, when its season is current", () => {
    expect(pickTeamsLeague(c, { ...none, remembered: "gone/2020-21", myTeam: { leagueId: "superettan-herr", seasonId: "2026-27" } })!.leagueId).toBe(
      "superettan-herr",
    );
  });

  it("then on the newest game's league", () => {
    expect(pickTeamsLeague(c, { ...none, myTeam: { leagueId: "superettan-herr", seasonId: "2025-26" }, newestGameLeagueId: "superettan-herr" })!.leagueId).toBe(
      "superettan-herr",
    );
  });

  it("else on the first league", () => {
    expect(pickTeamsLeague(c, { ...none, myTeam: { leagueId: "superettan-herr", seasonId: "2025-26" } })!.leagueId).toBe("sbl-herr");
    expect(pickTeamsLeague([], none)).toBeNull();
  });
});
