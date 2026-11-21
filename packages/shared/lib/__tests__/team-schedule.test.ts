import { describe, expect, it } from "vitest";
import type { GeniusFixture } from "../genius";
import { leagueSeason } from "../league-season";
import { formStrip, groupNames, leagueTables, meeting, nextGame, teamGameRows, teamNames } from "../team-schedule";
import { g, payload, st, tg } from "./helpers/season";

type Over = Partial<GeniusFixture> & { scores?: [string, string]; names?: [string, string] };

/** A finished regular-season fixture with play-by-play, home 80, away 75. */
function fx(matchId: number, home: number, away: number, over: Over = {}): GeniusFixture {
  const { scores = ["80", "75"], names = [`Team ${home}`, `Team ${away}`], ...rest } = over;
  return {
    matchId,
    matchTimeUTC: "2026-11-01 17:00:00",
    matchStatus: "COMPLETE",
    matchType: "REGULAR",
    statsSource: "x",
    venueName: "",
    competitors: [
      { teamId: home, teamName: names[0], scoreString: scores[0], isHomeCompetitor: 1, logoUrl: "" },
      { teamId: away, teamName: names[1], scoreString: scores[1], isHomeCompetitor: 0, logoUrl: "" },
    ],
    ...rest,
  };
}

const NOW = new Date("2026-11-20T12:00:00Z");
const two = [st(1, 10), st(2, 10, 2), st(3, 20), st(4, 20, 2)];

describe("teamGameRows", () => {
  it("joins a played game to its totals", () => {
    const rows = teamGameRows([fx(100, 1, 2)], payload([g(100, tg(1), tg(2, { pts: 75 }))]), 1, NOW);
    expect(rows[0]).toMatchObject({
      matchId: 100,
      home: true,
      opponentId: 2,
      opponentName: "Team 2",
      status: "played",
      result: "W",
      score: { own: 80, opp: 75 },
      importable: true,
    });
    expect(rows[0].ppp!.own).toBeCloseTo(80 / (65 - 10 + 12 + 0.44 * 16), 6);
    expect(rows[0].at).toBe("2026-11-01T17:00:00Z");
  });

  it("reads a game from the away side", () => {
    const [row] = teamGameRows([fx(100, 1, 2)], payload([]), 2, NOW);
    expect(row).toMatchObject({ home: false, opponentId: 1, result: "L", score: { own: 75, opp: 80 } });
  });

  it("shows a finished game without totals by its score alone", () => {
    expect(teamGameRows([fx(100, 1, 2)], payload([]), 1, NOW)[0]).toMatchObject({ status: "played", score: { own: 80, opp: 75 }, ppp: null });
  });

  it("has no score for a walkover", () => {
    const [row] = teamGameRows([fx(100, 1, 2, { scores: ["", ""] })], payload([]), 1, NOW);
    expect(row).toMatchObject({ status: "played", score: null, result: null });
    expect(formStrip([row])).toEqual([]);
  });

  it("lists a game still to play, and drops a cancelled or long-overdue one", () => {
    const rows = teamGameRows(
      [
        fx(1, 1, 2, { matchStatus: "SCHEDULED", matchTimeUTC: "2026-11-28 17:00:00" }),
        fx(2, 3, 1, { matchStatus: "CANCELLED", matchTimeUTC: "2026-11-29 17:00:00" }),
        fx(3, 1, 4, { matchStatus: "SCHEDULED", matchTimeUTC: "2026-10-01 17:00:00" }),
      ],
      payload([]),
      1,
      NOW,
    );
    expect(rows.map((r) => [r.matchId, r.status])).toEqual([[3, "off"], [1, "upcoming"], [2, "off"]]);
  });

  it("can't import a game without play-by-play", () => {
    expect(teamGameRows([fx(100, 1, 2, { statsSource: "" })], payload([]), 1, NOW)[0].importable).toBe(false);
  });

  it("leaves out other teams' games", () => {
    expect(teamGameRows([fx(100, 3, 4)], payload([]), 1, NOW)).toEqual([]);
  });
});

describe("formStrip", () => {
  it("draws the season from regular-season results, capped at twenty", () => {
    const rows = teamGameRows(
      [
        fx(1, 1, 2, { scores: ["110", "70"], matchTimeUTC: "2026-10-01 17:00:00" }),
        fx(2, 2, 1, { scores: ["90", "85"], matchTimeUTC: "2026-10-08 17:00:00" }),
        fx(3, 1, 2, { matchType: "FINALS", matchTimeUTC: "2026-10-15 17:00:00" }),
      ],
      payload([]),
      1,
      NOW,
    );
    expect(formStrip(rows)).toEqual([
      { matchId: 1, won: true, margin: 20 },
      { matchId: 2, won: false, margin: 5 },
    ]);
  });
});

describe("meeting", () => {
  it("finds the next meeting with the coach's team, else the last one", () => {
    const rows = teamGameRows([fx(1, 1, 2), fx(2, 2, 1, { matchStatus: "SCHEDULED", matchTimeUTC: "2026-11-28 17:00:00" })], payload([]), 1, NOW);
    expect(meeting(rows, new Set([2]))).toMatchObject({ kind: "next", row: { matchId: 2 } });
    expect(meeting(rows.slice(0, 1), new Set([2]))).toMatchObject({ kind: "last", row: { matchId: 1 } });
    expect(meeting(rows, new Set())).toBeNull();
    expect(meeting(rows, new Set([9]))).toBeNull();
  });
});

describe("teamNames and groupNames", () => {
  it("names a team as its newest fixture does", () => {
    const names = teamNames([
      fx(1, 1, 2, { names: ["Old name", "B"], matchTimeUTC: "2026-10-01 17:00:00" }),
      fx(2, 1, 2, { names: ["New name", "B"] }),
    ]);
    expect(names.get(1)!.name).toBe("New name");
  });

  it("names each group by its fixtures", () => {
    expect(groupNames([fx(1, 1, 2, { poolNumber: 10, phaseName: "Södra" }), fx(2, 3, 4)])).toEqual(new Map([[10, "Södra"]]));
  });
});

describe("leagueTables", () => {
  it("titles each group's table, and one table has no title", () => {
    const l = leagueSeason(payload([g(100, tg(1), tg(2)), g(200, tg(3), tg(4))], two));
    const named = [fx(100, 1, 2, { poolNumber: 10, phaseName: "Södra" }), fx(200, 3, 4, { poolNumber: 20, phaseName: "Norra" })];
    expect(leagueTables(l, named, new Set([100]), new Set([2])).map((t) => t.title)).toEqual(["Norra", "Södra"]);
    const bare = [fx(100, 1, 2), fx(200, 3, 4)];
    expect(leagueTables(l, bare, new Set(), new Set()).map((t) => t.title)).toEqual(["Group 1", "Group 2"]);
    const sodra = leagueTables(l, named, new Set([100]), new Set([2]))[1];
    expect(sodra.rows.map((r) => [r.teamId, r.libraryGames, r.mine])).toEqual([
      [1, 1, false],
      [2, 1, true],
    ]);
    expect(sodra.rows[0]).toMatchObject({ name: "Team 1", position: 1, won: 1, lost: 1, last5: "WL" });
    expect(sodra.rows[0].scores).toBeCloseTo(80 / (65 - 10 + 12 + 0.44 * 16), 6);
    const one = leagueSeason(payload([g(100, tg(1), tg(2))], [st(1, 10), st(2, 10, 2)]));
    expect(leagueTables(one, [fx(100, 1, 2, { poolNumber: 10, phaseName: "SBL Herr" })], new Set(), new Set())[0].title).toBeNull();
  });

  it("lists the standings' teams only: no extra table for an opponent the standings leave out", () => {
    const l = leagueSeason(payload([g(100, tg(5), tg(1))], [st(1, 10)]));
    const tables = leagueTables(l, [fx(100, 5, 1)], new Set(), new Set());
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ title: null });
    expect(tables[0].rows.map((r) => r.teamId)).toEqual([1]);
  });

  it("lists every team by its fixtures when there are no standings", () => {
    const l = leagueSeason(payload([g(100, tg(5), tg(1))]));
    expect(leagueTables(l, [fx(100, 5, 1)], new Set(), new Set()).flatMap((t) => t.rows.map((r) => r.teamId)).sort()).toEqual([1, 5]);
  });
});

describe("nextGame", () => {
  it("is the space's next game in this competition", () => {
    const fixtures = [
      fx(1, 1, 2, { matchStatus: "SCHEDULED", matchTimeUTC: "2026-12-05 17:00:00" }),
      fx(2, 3, 1, { matchStatus: "SCHEDULED", matchTimeUTC: "2026-11-28 17:00:00" }),
    ];
    expect(nextGame(fixtures, payload([]), new Set([1]), NOW)).toMatchObject({ matchId: 2, opponentId: 3, home: false });
  });

  it("has no next game for a space without a team here", () => {
    expect(nextGame([fx(1, 1, 2, { matchStatus: "SCHEDULED", matchTimeUTC: "2026-11-28 17:00:00" })], payload([]), new Set(), NOW)).toBeNull();
  });
});
