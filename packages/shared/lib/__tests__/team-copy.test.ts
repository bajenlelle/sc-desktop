import { describe, expect, it } from "vitest";
import { coverageLine, meetingLine, paceLine, placeTooltip } from "../team-copy";

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
