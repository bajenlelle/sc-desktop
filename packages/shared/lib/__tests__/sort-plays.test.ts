import { describe, expect, it } from "vitest";
import { sortPlaysChronologically } from "../events";
import { orderForAdd, type BrowserGame } from "../add-clips-games";
import type { PlayByPlayEvent } from "../../types/match";

const play = (eventId: number, period: number, realWorldTime: string): PlayByPlayEvent =>
  ({ eventId, period, realWorldTime }) as PlayByPlayEvent;

const ids = (plays: readonly PlayByPlayEvent[]) => plays.map((p) => p.eventId);

describe("sortPlaysChronologically", () => {
  it("orders by period, then wall-clock time, whatever order the plays arrive in", () => {
    const shuffled = [
      play(5, 2, "2026-01-01T19:30:00Z"),
      play(2, 1, "2026-01-01T19:05:00Z"),
      play(6, 2, "2026-01-01T19:31:00Z"),
      play(1, 1, "2026-01-01T19:01:00Z"),
      play(3, 1, "2026-01-01T19:10:00Z"),
    ];
    expect(ids(sortPlaysChronologically(shuffled))).toEqual([1, 2, 3, 5, 6]);
  });

  it("puts a later period after an earlier one even when its event id is lower", () => {
    expect(ids(sortPlaysChronologically([play(1, 2, "2026-01-01T19:30:00Z"), play(9, 1, "2026-01-01T19:05:00Z")]))).toEqual([9, 1]);
  });

  it("breaks a tie in time by event id", () => {
    const t = "2026-01-01T19:05:00Z";
    expect(ids(sortPlaysChronologically([play(8, 1, t), play(7, 1, t)]))).toEqual([7, 8]);
  });

  it("puts plays without a usable time after the timed ones of their period", () => {
    const sorted = sortPlaysChronologically([
      play(4, 1, ""),
      play(3, 1, "not a date"),
      play(2, 1, "2026-01-01T19:05:00Z"),
      play(9, 2, "2026-01-01T19:30:00Z"),
    ]);
    expect(ids(sorted)).toEqual([2, 3, 4, 9]);
  });

  it("returns a new array and leaves its input alone", () => {
    const input = [play(2, 1, "2026-01-01T19:05:00Z"), play(1, 1, "2026-01-01T19:01:00Z")];
    const sorted = sortPlaysChronologically(input);
    expect(sorted).not.toBe(input);
    expect(ids(input)).toEqual([2, 1]);
  });
});

describe("orderForAdd with plays that arrive out of order", () => {
  it("adds the ticked clips in the order the game was played", () => {
    const game: BrowserGame = {
      id: "g1",
      title: "A – B",
      date: "2026-01-01",
      homeTeam: { name: "A", color: "#000" },
      awayTeam: { name: "B", color: "#fff" },
      events: [play(30, 2, "2026-01-01T19:30:00Z"), play(10, 1, "2026-01-01T19:05:00Z"), play(20, 1, "2026-01-01T19:10:00Z")],
    };
    expect(orderForAdd(["g1:30", "g1:10", "g1:20"], [game])).toEqual([
      { type: "clip", matchId: "g1", eventId: 10 },
      { type: "clip", matchId: "g1", eventId: 20 },
      { type: "clip", matchId: "g1", eventId: 30 },
    ]);
  });
});
