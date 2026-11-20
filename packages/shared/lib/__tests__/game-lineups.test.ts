import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { gameLineups } from "../game-lineups";

let nextId = 1;
const A = [1, 2, 3, 4, 5];
const B = [1, 2, 3, 4, 6];
const AWAY = [11, 12, 13, 14, 15];

/** A home play at a clock with the fives on the floor. */
function at(period: number, clock: string, home: number[] | null, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: nextId++,
    type: "rebound",
    subType: "defensive",
    period,
    gameClockTime: clock,
    realWorldTime: "",
    isSuccessful: 1,
    player: { playerId: 1, pno: 1, firstName: "A", familyName: "One", teamNumber: 1 },
    eventTeam: { teamCode: "", teamName: "Home", teamNumber: 1 },
    qualifiers: [],
    onCourtHome: home,
    onCourtAway: home ? AWAY : null,
    ...extra,
  };
}
const basket = (team: 1 | 2): Partial<PlayByPlayEvent> => ({
  type: "2pt",
  subType: "layup",
  player: null,
  eventTeam: { teamCode: "", teamName: team === 1 ? "Home" : "Away", teamNumber: team },
});
const seconds = (list: ReturnType<typeof gameLineups>["home"], five: number[]) =>
  list.find((l) => l.personIds.join() === [...five].sort((a, b) => a - b).join())?.seconds;

describe("gameLineups", () => {
  it("a five's time runs from its first play to the next five's", () => {
    const g = gameLineups([at(1, "10:00", A), at(1, "06:00", A), at(1, "05:00", B), at(1, "01:00", B)]);
    expect(seconds(g.home, A)).toBe(240);
    expect(seconds(g.home, B)).toBe(360);
    expect(g.home[0].personIds).toEqual(B);
  });

  it("time is the game clock's, period by period", () => {
    const g = gameLineups([at(1, "08:00", A), at(1, "02:00", A), at(2, "09:00", B), at(2, "03:00", B)]);
    expect(seconds(g.home, A)).toBe(600);
    expect(seconds(g.home, B)).toBe(600);
  });

  it("overtime uses its own length", () => {
    const g = gameLineups([at(1, "10:00", A), at(5, "04:00", B), at(5, "01:00", B)]);
    expect(seconds(g.home, B)).toBe(300);
  });

  it("plus-minus is the score change while the five was on", () => {
    const g = gameLineups([
      at(1, "10:00", A),
      at(1, "09:00", A, basket(1)),
      at(1, "08:00", A, basket(1)),
      at(1, "07:00", A, basket(2)),
      at(1, "05:00", B, basket(2)),
    ]);
    const a = g.home.find((l) => l.personIds.join() === A.join())!;
    const b = g.home.find((l) => l.personIds.join() === B.join())!;
    expect(a.plusMinus).toBe(2);
    expect(b.plusMinus).toBe(-2);
    expect(g.away[0].plusMinus).toBe(0);
  });

  it("the five is the same whatever order the feed lists it", () => {
    const g = gameLineups([at(1, "10:00", [5, 4, 3, 2, 1]), at(1, "05:00", [1, 3, 2, 5, 4])]);
    expect(g.home).toHaveLength(1);
    expect(g.home[0].personIds).toEqual(A);
    expect(g.home[0].seconds).toBe(600);
  });

  it("no fives, no lineups", () => {
    expect(gameLineups([at(1, "10:00", null), at(1, "05:00", null)])).toEqual({ home: [], away: [] });
  });

  it("each lineup's plays are the plays it was listed on", () => {
    const plays = [at(1, "10:00", A), at(1, "06:00", A), at(1, "05:00", B)];
    const g = gameLineups(plays);
    expect(g.home.find((l) => l.personIds.join() === A.join())!.eventIds).toEqual([plays[0].eventId, plays[1].eventId]);
    expect(g.away[0].eventIds).toHaveLength(3);
  });
});
