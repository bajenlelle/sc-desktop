import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { chartShot, gameShots, zoneCells } from "../game-shots";

let nextId = 1;
function shot(type: "2pt" | "3pt" | "freethrow", x: number | null, y: number | null, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: nextId++,
    type,
    subType: "",
    period: 1,
    gameClockTime: "05:00",
    realWorldTime: "",
    isSuccessful: 1,
    player: { playerId: 7, pno: 7, firstName: "A", familyName: "Lind", teamNumber: 1 },
    eventTeam: { teamCode: "", teamName: "Home", teamNumber: 1 },
    qualifiers: [],
    x,
    y,
    ...extra,
  };
}

describe("chartShot", () => {
  it("a shot at the far end folds onto the near basket", () => {
    expect(chartShot(shot("2pt", 93, 54))).toMatchObject({ x: 7, y: 46 });
    expect(chartShot(shot("2pt", 6, 54))).toMatchObject({ x: 6, y: 54 });
  });

  it("zones: rim by distance, three by type", () => {
    expect(chartShot(shot("2pt", 6, 50))!.zone).toBe("rim");
    expect(chartShot(shot("2pt", 95, 52))!.zone).toBe("rim");
    expect(chartShot(shot("2pt", 25, 50))!.zone).toBe("mid");
    expect(chartShot(shot("3pt", 8, 52))!.zone).toBe("three");
    expect(chartShot(shot("3pt", 30, 20))!.zone).toBe("three");
  });

  it("the rim reaches 2 m from the basket: the staging data's break between lay-ups and jump shots", () => {
    // 12.4 % of the court's length is 1.9 m past the basket; 13.2 % is 2.1 m.
    expect(chartShot(shot("2pt", 12.4, 50))!.zone).toBe("rim");
    expect(chartShot(shot("2pt", 13.2, 50))!.zone).toBe("mid");
  });

  it("the feed's area names don't decide the zone: they overlap too much to tell rim from paint", () => {
    expect(chartShot(shot("2pt", 9, 56, { area: "inthepaint" }))!.zone).toBe("rim");
    expect(chartShot(shot("2pt", 20, 50, { area: "underbasket" }))!.zone).toBe("mid");
  });

  it("a play with no position has no chart shot", () => {
    expect(chartShot(shot("2pt", null, null))).toBeNull();
    expect(gameShots([shot("2pt", null, null), shot("3pt", null, null)]).hasPositions).toBe(false);
  });

  it("free throws are not chart shots", () => {
    expect(chartShot(shot("freethrow", 20, 50))).toBeNull();
  });

  it("splits a game's shots by side", () => {
    const away = shot("3pt", 70, 10, {
      player: { playerId: 9, pno: 9, firstName: "B", familyName: "Olsson", teamNumber: 2 },
      eventTeam: { teamCode: "", teamName: "Away", teamNumber: 2 },
      isSuccessful: 0,
    });
    const g = gameShots([shot("2pt", 6, 50), away]);
    expect(g.hasPositions).toBe(true);
    expect(g.home).toHaveLength(1);
    expect(g.away[0]).toMatchObject({ side: 2, made: false, personId: 9, zone: "three" });
  });
});

describe("zoneCells", () => {
  it("zone cells count makes of attempts", () => {
    const shots = [shot("2pt", 6, 50), shot("2pt", 5, 51), shot("2pt", 6, 49, { isSuccessful: 0 }), shot("3pt", 30, 10)]
      .map(chartShot)
      .filter((s) => s !== null);
    const z = zoneCells(shots);
    expect(z.rim).toMatchObject({ value: 2, attempts: 3 });
    expect(z.rim.eventIds).toHaveLength(3);
    expect(z.three).toMatchObject({ value: 1, attempts: 1 });
    expect(z.mid).toMatchObject({ value: 0, attempts: 0 });
    expect(Object.keys(z)).toEqual(["rim", "mid", "three"]);
  });
});
