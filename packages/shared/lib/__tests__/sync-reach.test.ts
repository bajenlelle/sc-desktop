import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import type { PeriodEvent } from "../period-sync";
import { joinNames, pickPeekPlays, quartersMoved, syncReach } from "../sync-reach";

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
const marks: SyncPoint["marks"] = {
  "1": mark(1, "17:30:00", "17:52:00"),
  "2": mark(2, "17:54:00", "18:16:00"),
  "3": mark(3, "18:26:00", "18:46:00"),
  "4": mark(4, "18:48:00", "19:08:00"),
};
const q1: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: T("17:30:00"), marks };
const withQ3: SyncPoint = { ...q1, periods: { "3": { syncVideoTime: 2700, syncRealWorldTime: T("18:26:00") } } };
const inQ2 = { period: 2, realWorldTime: T("18:05:00") }; // halfway through Q2
const inQ3 = { period: 3, realWorldTime: T("18:33:00") }; // 7 min into 20

const moved = (r: ReturnType<typeof syncReach>) => r.segments.map((s) => [s.name, s.moved] as const);
const all = { from: 0, to: 1 };

describe("syncReach: the segments", () => {
  it("lists the game's periods, marking the ones with their own sync", () => {
    expect(syncReach(withQ3, events, inQ2, null).segments.map((s) => [s.name, s.set])).toEqual([
      ["Q1", true],
      ["Q2", false],
      ["Q3", true],
      ["Q4", false],
    ]);
  });

  it("puts the play's tick where it falls in its quarter", () => {
    expect(syncReach(q1, events, inQ3, null).play).toEqual({ period: 3, at: 0.35 });
  });

  it("has no tick for a play without a time", () => {
    expect(syncReach(q1, events, { period: 3, realWorldTime: null }, null).play).toBeNull();
  });

  it("names overtime", () => {
    const ot = [...events, play(5, "19:12:00"), play(5, "19:16:30")];
    expect(syncReach(q1, ot, inQ3, "game").segments.at(-1)?.name).toBe("OT1");
  });
});

describe("syncReach: what each choice moves", () => {
  it("nothing before a choice, and nothing for only this clip", () => {
    expect(moved(syncReach(q1, events, inQ2, null)).every(([, m]) => m === null)).toBe(true);
    expect(moved(syncReach(q1, events, inQ2, "clip")).every(([, m]) => m === null)).toBe(true);
  });

  it("from this play on: the rest of its quarter and the quarters that follow it", () => {
    expect(moved(syncReach(q1, events, inQ2, "play"))).toEqual([
      ["Q1", null],
      ["Q2", { from: 0.5, to: 1 }],
      ["Q3", all],
      ["Q4", all],
    ]);
  });

  it("from this play on stops at a quarter with its own sync", () => {
    expect(moved(syncReach(withQ3, events, inQ2, "play"))).toEqual([
      ["Q1", null],
      ["Q2", { from: 0.5, to: 1 }],
      ["Q3", null],
      ["Q4", null],
    ]);
  });

  it("from this play on stops at a later fix inside the quarter", () => {
    const later: SyncPoint = { ...q1, cuts: [{ period: 2, syncRealWorldTime: T("18:10:30"), syncVideoTime: 2000 }] };
    expect(moved(syncReach(later, events, inQ2, "play"))).toEqual([
      ["Q1", null],
      ["Q2", { from: 0.5, to: 0.75 }],
      ["Q3", null],
      ["Q4", null],
    ]);
  });

  it("from this quarter on: the whole quarter and the ones that follow it", () => {
    expect(moved(syncReach(q1, events, inQ3, "quarter"))).toEqual([
      ["Q1", null],
      ["Q2", null],
      ["Q3", all],
      ["Q4", all],
    ]);
    const withQ4: SyncPoint = { ...q1, periods: { "4": { syncVideoTime: 3900, syncRealWorldTime: T("18:48:00") } } };
    expect(moved(syncReach(withQ4, events, inQ3, "quarter"))).toEqual([
      ["Q1", null],
      ["Q2", null],
      ["Q3", all],
      ["Q4", null],
    ]);
  });

  it("the whole game: everything", () => {
    expect(moved(syncReach(withQ3, events, inQ3, "game")).every(([, m]) => m?.from === 0 && m?.to === 1)).toBe(true);
  });
});

describe("quartersMoved", () => {
  it("names the quarter and the ones that follow it without their own sync", () => {
    expect(quartersMoved(q1, events, 3)).toEqual(["Q3", "Q4"]);
    expect(quartersMoved(withQ3, events, 2)).toEqual(["Q2"]);
    expect(quartersMoved(q1, events, 1)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
});

describe("pickPeekPlays", () => {
  const p = (period: number, hms: string | null, eventId: number) => ({ period, realWorldTime: hms ? T(hms) : null, eventId });
  const me = p(3, "18:33:00", 30);

  it("picks the play nearest in time from each other quarter, in quarter order", () => {
    const others = [p(4, "18:50:00", 40), p(1, "17:35:00", 10), p(2, "18:00:00", 20), p(1, "17:50:00", 11), p(3, "18:40:00", 31)];
    expect(pickPeekPlays(me, others).map((e) => e.eventId)).toEqual([11, 20, 40]);
  });

  it("ignores plays without a time, and gives nothing when no other quarter is there", () => {
    expect(pickPeekPlays(me, [p(1, null, 10), p(3, "18:40:00", 31)])).toEqual([]);
  });
});

describe("joinNames", () => {
  it("reads as a list", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Q3"])).toBe("Q3");
    expect(joinNames(["Q3", "Q4"])).toBe("Q3 and Q4");
    expect(joinNames(["Q2", "Q3", "Q4"])).toBe("Q2, Q3 and Q4");
  });
});
