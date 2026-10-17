import { describe, expect, it } from "vitest";
import {
  HostedLayoutError,
  hostedBoxScoreUrl,
  hostedPlayerStatsUrl,
  parseHostedBoxScore,
  parseHostedPlayerStats,
} from "../hosted-stats";
import { HOSTED_BOXSCORE_HTML as boxHtml, HOSTED_PLAYER_STATS_HTML as seasonHtml } from "./fixtures/hosted-pages";

describe("hosted stats URLs", () => {
  it("builds the box score and player statistics pages", () => {
    expect(hostedBoxScoreUrl(41539, "2668882")).toBe(
      "https://hosted.dcd.shared.geniussports.com/SBF/en/competition/41539/match/2668882/boxscore",
    );
    expect(hostedPlayerStatsUrl(42132)).toBe(
      "https://hosted.dcd.shared.geniussports.com/SBF/en/competition/42132/statistics/player",
    );
  });
});

describe("parseHostedBoxScore", () => {
  const teams = parseHostedBoxScore(boxHtml);

  it("reads one table per team with its Genius teamId and name", () => {
    expect(teams.map((t) => [t.teamId, t.teamName])).toEqual([
      ["900001", "Home Team"],
      ["900002", "Away Team"],
    ]);
  });

  it("keeps player rows only: the totals row has no person link", () => {
    expect(teams[0].players.map((p) => p.personId)).toEqual(["1000001", "1000002", "1000003", "1000004"]);
    expect(teams[1].players).toHaveLength(4);
  });

  it("maps every column by its header label", () => {
    const p = teams[0].players[2];
    expect(p.printedName).toBe("Player03, P.");
    expect(p.number).toBe("21");
    expect(p.line).toEqual({
      min: 32 * 60 + 19,
      pts: 17,
      fgm: 6, // 4 twos + 2 threes
      fga: 12,
      tpm: 2,
      tpa: 4,
      ftm: 3,
      fta: 4,
      oreb: 0,
      dreb: 6,
      ast: 5,
      stl: 2,
      blk: 0,
      tov: 4,
      pf: 1,
      pm: 7,
    });
  });

  it("reads negative plus-minus and a did-not-play row as 0:00", () => {
    expect(teams[1].players[2].line.pm).toBe(-13);
    expect(teams[0].players[3].line.min).toBe(0);
  });

  it("refuses a page whose headers changed instead of guessing", () => {
    expect(() => parseHostedBoxScore(boxHtml.replaceAll(">Pts<", ">Points<"))).toThrow(HostedLayoutError);
    expect(() => parseHostedBoxScore("<html><body>Maintenance</body></html>")).toThrow(/hosted_layout_changed/);
  });
});

describe("parseHostedPlayerStats", () => {
  const players = parseHostedPlayerStats(seasonHtml);

  it("joins the three tables by personId", () => {
    expect([...players.keys()]).toEqual(["2000001", "2000002", "2000003", "2000004"]);
    expect(players.get("2000002")?.name).toBe("Player 02");
  });

  it("keeps a single row exactly as published", () => {
    expect(players.get("2000002")).toEqual({
      personId: "2000002",
      name: "Player 02",
      stints: 1,
      line: {
        gp: 28,
        gs: 16,
        mpg: 25.8,
        ppg: 10.7,
        rpg: 5.2,
        orpg: 2.3,
        drpg: 2.9,
        apg: 1.6,
        spg: 1.0,
        bpg: 0.2,
        topg: 1.6,
        pfpg: 3.2,
        fgPct: 48.3,
        tpm: 6,
        tpa: 25,
        tpPct: 24.0,
        ftPct: 66.7,
        pmPg: -0.5,
      },
    });
  });

  it("combines a player listed once per team, weighting by games", () => {
    // Rows: 7 games (11.9 ppg) and 9 games (7.1 ppg).
    const p = players.get("2000004")!;
    expect(p.stints).toBe(2);
    expect(p.line.gp).toBe(16);
    expect(p.line.gs).toBe(11);
    expect(p.line.ppg).toBeCloseTo((11.9 * 7 + 7.1 * 9) / 16, 6);
    expect(p.line.mpg).toBeCloseTo((24.6 * 7 + 13.4 * 9) / 16, 6);
    expect(p.line.tpm).toBe(15);
    expect(p.line.tpa).toBe(44);
    expect(p.line.tpPct).toBeCloseTo((100 * 15) / 44, 6);
    // (19 + 8 + 19 + 7) made of (46 + 29 + 40 + 15) attempted.
    expect(p.line.fgPct).toBeCloseTo((100 * 53) / 130, 6);
    expect(p.line.ftPct).toBeCloseTo((100 * (0.618 * 4.9 * 7 + 0.556 * 1.0 * 9)) / (4.9 * 7 + 9), 6);
    expect(p.line.pmPg).toBeCloseTo(9 / 16, 6);
  });

  it("refuses a page whose tables or headers changed", () => {
    expect(() => parseHostedPlayerStats(seasonHtml.replaceAll(">FG%<", ">FGP<"))).toThrow(HostedLayoutError);
    expect(() => parseHostedPlayerStats(seasonHtml.replaceAll(">STPG<", ">SPG<"))).toThrow(/averages table lacks STPG/);
  });
});
