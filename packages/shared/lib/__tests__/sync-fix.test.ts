import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import { computeVideoTime } from "../clip-timing";
import { shiftPeriod, shiftWholeGame, syncFromPlayOn, type PeriodEvent } from "../period-sync";
import { planSyncFix } from "../sync-fix";

// The game from period-sync.test.ts: Q1 17:30–17:52, Q2 17:54–18:16, Q3
// 18:26–18:46, Q4 18:48–19:08 on the wall clock, with the league's times.
const T = (hms: string) => `2026-09-20T${hms}Z`;
const play = (period: number, hms: string): PeriodEvent => ({
  period,
  realWorldTime: T(hms),
  type: "rebound",
  isSuccessful: 0,
  eventTeam: { teamCode: "", teamName: "Lidingö", teamNumber: 1 },
  scoreHome: null,
  scoreAway: null,
});
const events: PeriodEvent[] = [
  play(1, "17:30:30"), play(1, "17:51:50"),
  play(2, "17:54:30"), play(2, "18:15:55"),
  play(3, "18:26:40"), play(3, "18:45:58"),
  play(4, "18:48:15"), play(4, "19:07:59"),
];
const mark = (p: number, start: string, end: string) => ({
  startRealWorldTime: T(start),
  endRealWorldTime: T(end),
  anchor: { realWorldTime: T(start), kind: "period_start" as const, label: `Start of Q${p}` },
});
const sync: SyncPoint = {
  syncVideoTime: 42,
  syncRealWorldTime: T("17:30:00"),
  marks: { "1": mark(1, "17:30:00", "17:52:00"), "2": mark(2, "17:54:00", "18:16:00"), "3": mark(3, "18:26:00", "18:46:00"), "4": mark(4, "18:48:00", "19:08:00") },
};
const inQ3 = { eventId: 7, period: 3, realWorldTime: T("18:33:00") };
const inQ1 = { eventId: 2, period: 1, realWorldTime: T("17:40:00") };
const at = (e: { period: number; realWorldTime: string }) => computeVideoTime(e, sync)!;

describe("planSyncFix", () => {
  it("clip: no new sync, just how far the play moved", () => {
    expect(planSyncFix(sync, events, inQ3, "clip", at(inQ3) + 4, 10)).toEqual({ next: null, delta: 4 });
  });

  it("quarter on Q2 or later: the quarter shifts and the video is marked as skipping the breaks", () => {
    expect(planSyncFix(sync, events, inQ3, "quarter", at(inQ3) + 4, 10)).toEqual({
      next: { ...shiftPeriod(sync, events, 3, 4), breaksCut: true },
      delta: 4,
    });
  });

  it("quarter on Q1: the quarter shifts, nothing is said about the breaks", () => {
    const plan = planSyncFix(sync, events, inQ1, "quarter", at(inQ1) - 2, 10)!;
    expect(plan).toEqual({ next: shiftPeriod(sync, events, 1, -2), delta: -2 });
    expect("breaksCut" in plan.next!).toBe(false);
  });

  it("play: a cut from where the clip starts, remembering the play", () => {
    const found = at(inQ3) + 4;
    expect(planSyncFix(sync, events, inQ3, "play", found, 10)).toEqual({
      next: syncFromPlayOn(sync, inQ3, found, 10),
      delta: 4,
    });
  });

  it("game: every quarter shifts", () => {
    expect(planSyncFix(sync, events, inQ3, "game", at(inQ3) + 4, 10)).toEqual({ next: shiftWholeGame(sync, 4), delta: 4 });
  });

  it("a play the sync can't place has no plan", () => {
    expect(planSyncFix(sync, events, { eventId: 9, period: 3, realWorldTime: null }, "play", 100, 10)).toBeNull();
  });
});
