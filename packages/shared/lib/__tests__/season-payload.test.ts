import { describe, expect, it } from "vitest";
import { seasonPayload, trimTeamGame } from "../season-payload";

/** A Genius teammatch row: whole game unless `periodNumber` says otherwise. */
function row(matchId: number, teamId: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { matchId, teamId, periodType: "REGULAR", periodNumber: 0, sPoints: 80, ...extra };
}

function fixture(matchId: number, home: number, away: number, matchType = "REGULAR"): Record<string, unknown> {
  return {
    matchId,
    matchType,
    competitors: [
      { teamId: home, isHomeCompetitor: 1 },
      { teamId: away, isHomeCompetitor: 0 },
    ],
  };
}

describe("trimTeamGame", () => {
  it("maps every field it keeps and turns a missing one into 0", () => {
    const g = trimTeamGame({
      teamId: 7,
      sPoints: 88,
      sPointsAgainst: 80,
      sFieldGoalsMade: 31,
      sFieldGoalsAttempted: 66,
      sThreePointersMade: 9,
      sThreePointersAttempted: 27,
      sFreeThrowsMade: 17,
      sFreeThrowsAttempted: 22,
      sReboundsOffensive: 12,
      sReboundsDefensive: 28,
      sReboundsTeamOffensive: 2,
      sReboundsTeamDefensive: 3,
      sReboundsOffensiveDeadball: 1,
      sReboundsDefensiveDeadball: null,
      sTurnovers: 13,
      sTurnoversTeam: 1,
      sPointsInThePaint: 34,
      sPointsSecondChance: 11,
      sPointsFastBreak: 8,
      sPointsFromTurnovers: 15,
    });
    expect(g).toEqual({
      teamId: 7,
      pts: 88,
      ptsAgainst: 80,
      fgm: 31,
      fga: 66,
      tpm: 9,
      tpa: 27,
      ftm: 17,
      fta: 22,
      oreb: 12,
      dreb: 28,
      orebTeam: 2,
      drebTeam: 3,
      orebDeadball: 1,
      drebDeadball: 0,
      tov: 13,
      tovTeam: 1,
      paint: 34,
      secondChance: 11,
      fastBreak: 8,
      offTurnovers: 15,
      bench: 0,
    });
  });
});

describe("seasonPayload", () => {
  it("keeps whole-game rows only, each on the side its team plays", () => {
    const p = seasonPayload(
      [row(1, 10, { sPoints: 90 }), row(1, 20, { sPoints: 70 }), row(1, 10, { periodType: "REGULAR", periodNumber: 1, sPoints: 20 }), row(1, 20, { periodType: "OVERTIME", periodNumber: 1, sPoints: 5 })],
      [fixture(1, 20, 10)],
      [],
      "2026-11-20T12:00:00Z",
    );
    expect(p.fetchedAt).toBe("2026-11-20T12:00:00Z");
    expect(p.games).toHaveLength(1);
    const [g] = p.games;
    expect([g.matchId, g.matchType, g.homeTeamId, g.awayTeamId]).toEqual([1, "REGULAR", 20, 10]);
    expect(g.home?.teamId).toBe(20);
    expect(g.home?.pts).toBe(70);
    expect(g.away?.pts).toBe(90);
  });

  it("keeps only regular whole-game rows, never another period kind numbered 0", () => {
    const p = seasonPayload([row(1, 10, { sPoints: 90 }), row(1, 10, { periodType: "OVERTIME", sPoints: 7 })], [fixture(1, 10, 20)], [], "t");
    expect(p.games[0].home?.pts).toBe(90);
    const only = seasonPayload([row(1, 10, { periodType: "OVERTIME" })], [fixture(1, 10, 20)], [], "t");
    expect(only.games[0].home).toBeUndefined();
  });

  it("says when every fixture of the season is complete", () => {
    const done = (f: Record<string, unknown>) => ({ ...f, matchStatus: "COMPLETE" });
    expect(seasonPayload([], [done(fixture(1, 10, 20)), done(fixture(2, 20, 10))], [], "t").complete).toBe(true);
    expect(seasonPayload([], [done(fixture(1, 10, 20)), { ...fixture(2, 20, 10), matchStatus: "SCHEDULED" }], [], "t").complete).toBe(false);
    expect(seasonPayload([], [], [], "t").complete).toBe(false);
  });

  it("lists a fixture before its statistics exist", () => {
    const p = seasonPayload([], [fixture(2, 10, 20, "FINALS")], [], "t");
    expect(p.games).toEqual([{ matchId: 2, matchType: "FINALS", homeTeamId: 10, awayTeamId: 20 }]);
  });

  it("leaves out a fixture with no home competitor, and a row with no fixture", () => {
    const noHome = { matchId: 3, matchType: "REGULAR", competitors: [{ teamId: 10, isHomeCompetitor: 0 }, { teamId: 20, isHomeCompetitor: 0 }] };
    const p = seasonPayload([row(3, 10), row(4, 10)], [noHome], [], "t");
    expect(p.games).toEqual([]);
  });

  it("reads a fixture with no match type as an empty one", () => {
    const f = fixture(5, 10, 20);
    delete f.matchType;
    expect(seasonPayload([], [f], [], "t").games[0].matchType).toBe("");
  });

  it("trims the standings, streak and last five as text", () => {
    const p = seasonPayload(
      [],
      [],
      [
        { teamId: 10, position: 6, poolNumber: 1, matchType: "REGULAR", played: 12, won: 5, lost: 7, streak: -2, teamName: "x" },
        { teamId: 20, position: 1, played: 12, won: 11, lost: 1, streak: "3", last5: "WWLWW" },
      ],
      "t",
    );
    expect(p.standings).toEqual([
      { teamId: 10, position: 6, poolNumber: 1, matchType: "REGULAR", played: 12, won: 5, lost: 7, last5: "", streak: "-2" },
      { teamId: 20, position: 1, poolNumber: null, matchType: "", played: 12, won: 11, lost: 1, last5: "WWLWW", streak: "3" },
    ]);
  });
});
