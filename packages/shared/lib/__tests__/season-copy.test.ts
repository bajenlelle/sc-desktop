import { describe, expect, it } from "vitest";
import {
  allowedLine,
  formatFactor,
  gapCaption,
  lastFiveLine,
  ordinal,
  seasonHoverLine,
  seasonKey,
  standingLine,
  usuallyPerGame,
} from "../season-copy";

describe("season copy", () => {
  it("writes places as ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th",
    ]);
  });

  it("formats a factor as the bars do", () => {
    expect(formatFactor("efg", 0.524)).toBe("52%");
    expect(formatFactor("ppp", 1.183)).toBe("1.18");
    expect(formatFactor("ftRate", 0.3)).toBe("0.30");
  });

  it("captions a real gap with the usual value and the rank", () => {
    expect(gapCaption("efg", 0.52, 4)).toBe("usually 52% · 4th");
    expect(gapCaption("efg", 0.52, null)).toBe("usually 52%");
  });

  it("says in the hover how many games the season is", () => {
    expect(seasonHoverLine("efg", 0.52, 11, 4, 11, true)).toBe("Season, 11 other games: 52% · 4th of 11");
    expect(seasonHoverLine("efg", 0.52, 1, null, 11, true)).toBe("Season, 1 other game: 52%");
    expect(seasonHoverLine("efg", 0.52, 22, 4, 11, false)).toBe("Regular season, 22 games: 52% · 4th of 11");
  });

  it("says what the opponent usually allows, turnovers as forced", () => {
    expect(allowedLine("efg", "Uppsala", 0.51)).toBe("Uppsala usually allows 51%");
    expect(allowedLine("tovRate", "Borås", 0.13)).toBe("Borås usually forces turnovers on 13%");
    expect(allowedLine("ppp", "Uppsala", 1.02)).toBe("Uppsala usually allows 1.02");
  });

  it("keys the marks with the games they come from", () => {
    expect(seasonKey(11, 11, true)).toBe("Each line marks the team's season, from its other 11 games.");
    expect(seasonKey(11, 10, true)).toBe("Each line marks the team's season, from their other games (11 and 10).");
    expect(seasonKey(3, 3, true)).toBe("Each line marks the team's season after 3 games.");
    expect(seasonKey(3, 2, true)).toBe("Each line marks the team's season after 3 and 2 games.");
    expect(seasonKey(1, 1, true)).toBe("Each line marks the team's season after 1 game.");
    expect(seasonKey(22, 22, false)).toBe("Each line marks the team's regular season, from its 22 games.");
    expect(seasonKey(22, 21, false)).toBe("Each line marks the team's regular season, from their games (22 and 21).");
    expect(seasonKey(0, 0, true)).toBeNull();
  });

  it("writes a team's place in the table", () => {
    expect(standingLine({ position: 5, won: 7, lost: 5, last5: "LWWLW", streak: "4" })).toBe("5th · 7–5 · won 4");
    expect(standingLine({ position: 6, won: 5, lost: 7, last5: "", streak: "-2" })).toBe("6th · 5–7 · lost 2");
    expect(standingLine({ position: 1, won: 0, lost: 0, last5: "", streak: "" })).toBe("1st · 0–0");
    expect(lastFiveLine("LWWLW")).toBe("Today's table. Last five: L W W L W.");
    expect(lastFiveLine("")).toBe("Today's table.");
  });

  it("rounds a usual figure to whole points a game", () => {
    expect(usuallyPerGame(37.6)).toBe("usually 38 a game");
  });
});
