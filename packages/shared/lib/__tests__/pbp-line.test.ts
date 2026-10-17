import { describe, expect, it } from "vitest";
import { pbpLine } from "../pbp-line";
import { gameEfficiency, gameRebounds, type GameLine } from "../stat-lines";
import type { PlayByPlayEvent } from "../../types/match";

let nextId = 1;
function ev(type: string, partial: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: nextId++,
    type,
    subType: "",
    period: 1,
    gameClockTime: "09:45",
    realWorldTime: "2026-01-10T18:05:00Z",
    isSuccessful: 1,
    player: { playerId: 42, pno: 7, firstName: "Alva", familyName: "Berg", teamNumber: 1 },
    eventTeam: { teamCode: "", teamName: "Bajen", teamNumber: 1 },
    qualifiers: [],
    ...partial,
  };
}

const other = { playerId: 99, pno: 4, firstName: "Ines", familyName: "Ek", teamNumber: 2 };

const genius: PlayByPlayEvent[] = [
  ev("2pt"),
  ev("2pt", { isSuccessful: 0 }),
  ev("3pt"),
  ev("3pt", { isSuccessful: 0 }),
  ev("freethrow"),
  ev("freethrow", { isSuccessful: 0 }),
  ev("rebound", { subType: "offensive" }),
  ev("rebound", { subType: "defensive" }),
  ev("rebound", { subType: "defensive" }),
  ev("rebound", { subType: "offensivedeadball" }), // bookkeeping, not a rebound
  ev("assist"),
  ev("steal"),
  ev("block"),
  ev("turnover"),
  ev("foul", { subType: "personal" }),
  ev("foulon"), // a foul drawn isn't a foul committed
  ev("2pt", { player: other }),
  ev("rebound", { player: null, subType: "defensive" }), // team rebound
];

describe("pbpLine", () => {
  it("counts a Genius player's line from the stored play-by-play", () => {
    expect(pbpLine(genius, 42, "genius")).toEqual({
      min: null,
      pts: 6,
      fgm: 2,
      fga: 4,
      tpm: 1,
      tpa: 2,
      ftm: 1,
      fta: 2,
      oreb: 1,
      dreb: 2,
      ast: 1,
      stl: 1,
      blk: 1,
      tov: 1,
      pf: 1,
      pm: null,
    });
  });

  it("matches the player id whether it arrives as a number or a string", () => {
    expect(pbpLine(genius, "42", "genius").pts).toBe(6);
    expect(pbpLine(genius, 99, "genius").pts).toBe(2);
  });

  it("leaves what Profixio doesn't record as null, not zero", () => {
    const profixio = [ev("2pt"), ev("3pt"), ev("freethrow"), ev("foul", { subType: "personal" })];
    expect(pbpLine(profixio, 42, "profixio")).toEqual({
      min: null,
      pts: 6,
      fgm: 2,
      fga: null,
      tpm: 1,
      tpa: null,
      ftm: 1,
      fta: null,
      oreb: null,
      dreb: null,
      ast: null,
      stl: null,
      blk: null,
      tov: null,
      pf: 1,
      pm: null,
    });
  });
});

describe("gameEfficiency", () => {
  const line: GameLine = {
    min: 1939, pts: 17, fgm: 6, fga: 12, tpm: 2, tpa: 4, ftm: 3, fta: 4,
    oreb: 0, dreb: 6, ast: 5, stl: 2, blk: 0, tov: 4, pf: 1, pm: 7,
  };

  it("is PTS + REB + AST + STL + BLK − missed FG − missed FT − TO", () => {
    expect(gameRebounds(line)).toBe(6);
    expect(gameEfficiency(line)).toBe(17 + 6 + 5 + 2 + 0 - 6 - 1 - 4);
  });

  it("is null when any input is unknown", () => {
    expect(gameEfficiency({ ...line, ast: null })).toBeNull();
    expect(gameEfficiency(pbpLine([ev("2pt")], 42, "profixio"))).toBeNull();
  });
});
