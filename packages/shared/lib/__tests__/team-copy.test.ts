import { describe, expect, it } from "vitest";
import { coverageLine, meetingLine, paceLine, pickLabel, placeTooltip, playersCell, videoKeyLine } from "../team-copy";
import type { KeyStat, PlaysSide } from "../team-video";

describe("meetingLine", () => {
  it("writes the next meeting from the coach's side", () => {
    expect(meetingLine({ kind: "next", home: true, score: null }, "Sat 28 Nov")).toBe("You play them Sat 28 Nov, away.");
    expect(meetingLine({ kind: "next", home: false, score: null }, "Sat 28 Nov")).toBe("You play them Sat 28 Nov, at home.");
  });

  it("writes the last meeting as the coach's result", () => {
    expect(meetingLine({ kind: "last", home: true, score: { own: 81, opp: 83 } }, "19 Oct")).toBe("You beat them 83–81 on 19 Oct.");
    expect(meetingLine({ kind: "last", home: true, score: { own: 83, opp: 81 } }, "19 Oct")).toBe("You lost to them 81–83 on 19 Oct.");
  });
});

describe("coverageLine", () => {
  it("counts the coverage", () => {
    expect(coverageLine(12, 3)).toBe("12 games played · 3 in your library");
    expect(coverageLine(12, 0)).toBe("12 games played · none in your library yet");
    expect(coverageLine(1, 1)).toBe("1 game played · 1 in your library");
  });
});

describe("placeTooltip", () => {
  it("says a place in words", () => {
    expect(placeTooltip(4, 12, null)).toBe("4th of 12 in the league");
    expect(placeTooltip(4, 14, "Södra")).toBe("4th of 14 in Södra");
  });
});

describe("paceLine", () => {
  it("writes the pace", () => {
    expect(paceLine(78.2, 2, 12)).toBe("78 possessions a game, 2nd fastest.");
    expect(paceLine(78.2, 1, 12)).toBe("78 possessions a game, the fastest.");
    expect(paceLine(66, 12, 12)).toBe("66 possessions a game, the slowest.");
    expect(paceLine(70, null, 12)).toBe("70 possessions a game.");
  });
});

describe("videoKeyLine", () => {
  it.each([
    ["threes", "with", { count: 98, made: 34 }, 3, "In your 3 games: 34 of 98 threes"],
    ["oreb", "with", { count: 38, made: null }, 3, "In your 3 games: 38 offensive rebounds"],
    ["tov", "with", { count: 41, made: null }, 3, "In your 3 games: 41 turnovers"],
    ["tov", "without", { count: 44, made: null }, 3, "In your 3 games: 44 turnovers forced"],
    ["oreb", "without", { count: 22, made: null }, 3, "In your 3 games: 22 offensive rebounds against them"],
    ["threes", "without", { count: 81, made: 30 }, 3, "In your 3 games: 30 of 81 threes against them"],
    ["oreb", "with", { count: 1, made: null }, 1, "In your game: 1 offensive rebound"],
    ["tov", "with", { count: 1, made: null }, 2, "In your 2 games: 1 turnover"],
    ["threes", "with", { count: 1, made: 1 }, 1, "In your game: 1 of 1 three"],
    ["tov", "with", { count: 0, made: null }, 2, "In your 2 games: 0 turnovers"],
  ])("%s %s", (stat, side, c, n, line) => expect(videoKeyLine(stat as KeyStat, side as PlaysSide, c, n as number)).toBe(line));
});

describe("pickLabel", () => {
  it("names the pick and its count", () => {
    expect(pickLabel({ kind: "stat", stat: "threes", side: "with" }, 98, 34)).toBe("Threes · 34 of 98");
    expect(pickLabel({ kind: "stat", stat: "oreb", side: "with" }, 38, null)).toBe("Offensive rebounds · 38");
    expect(pickLabel({ kind: "stat", stat: "tov", side: "with" }, 41, null)).toBe("Turnovers · 41");
    expect(pickLabel({ kind: "stat", stat: "threes", side: "without" }, 81, 30)).toBe("Threes against them · 30 of 81");
    expect(pickLabel({ kind: "stat", stat: "oreb", side: "without" }, 22, null)).toBe("Offensive rebounds against them · 22");
    expect(pickLabel({ kind: "stat", stat: "tov", side: "without" }, 44, null)).toBe("Turnovers forced · 44");
    expect(pickLabel({ kind: "zone", zone: "rim" }, 102, 58)).toBe("At the rim · 58 of 102");
    expect(pickLabel({ kind: "zone", zone: "mid" }, 38, 14)).toBe("Mid-range · 14 of 38");
    expect(pickLabel({ kind: "zone", zone: "three" }, 98, 34)).toBe("Threes · 34 of 98");
    expect(pickLabel({ kind: "player", personId: 7, name: "Erik Lind" }, 112, null)).toBe("Erik Lind · 112");
  });
});

describe("playersCell", () => {
  it("counts the games", () => {
    expect(playersCell(3)).toBe("3 games");
    expect(playersCell(1)).toBe("1 game");
  });
});
