import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import { computeVideoTime } from "../clip-timing";
import {
  carrySyncOver,
  clearAllPeriodSyncs,
  clearSyncCut,
  firstPlayOfCut,
  nextFixAfter,
  normalizeSyncPoint,
  shiftPeriod,
  shiftWholeGame,
  syncFromPlayOn,
} from "../period-sync";

// Q1 tip-off at 0:42, 17:30:00 on the wall clock. Q2 has its own sync (the
// video skips the first break). Times below are wall-clock minutes past 17:30.
const T = (min: number, sec = 0) => new Date(Date.UTC(2026, 8, 20, 17, 30 + min, sec)).toISOString();
const base: SyncPoint = {
  syncVideoTime: 42,
  syncRealWorldTime: T(0),
  periods: { "2": { syncVideoTime: 642, syncRealWorldTime: T(12) } },
};
// A cut 20 s long in the video, 5 minutes into Q2: plays from 17:47 on sit 20 s earlier.
const cutQ2: SyncPoint = { ...base, cuts: [{ period: 2, syncRealWorldTime: T(17), syncVideoTime: 922 }] };
const at = (period: number, min: number, sec = 0) => ({ period, realWorldTime: T(min, sec) });

describe("a cut in the video (From this play on)", () => {
  it("moves the plays at and after it", () => {
    expect(computeVideoTime(at(2, 17), cutQ2)).toBe(922);
    expect(computeVideoTime(at(2, 18), cutQ2)).toBe(982);
  });

  it("leaves the plays before it alone", () => {
    expect(computeVideoTime(at(2, 16), cutQ2)).toBe(882);
    expect(computeVideoTime(at(1, 5), cutQ2)).toBe(342);
  });

  it("carries on into a later quarter that has no sync of its own", () => {
    expect(computeVideoTime(at(3, 34), cutQ2)).toBe(1942);
  });

  it("stops at a later quarter that has its own sync", () => {
    const q3: SyncPoint = { ...cutQ2, periods: { ...cutQ2.periods, "3": { syncVideoTime: 1500, syncRealWorldTime: T(34) } } };
    expect(computeVideoTime(at(3, 35), q3)).toBe(1560);
  });

  it("wins over its own quarter's sync for the plays after it", () => {
    const cutQ1: SyncPoint = { ...base, cuts: [{ period: 1, syncRealWorldTime: T(5), syncVideoTime: 330 }] };
    expect(computeVideoTime(at(1, 6), cutQ1)).toBe(390);
    // Q2 has its own sync, so the Q1 cut doesn't reach it.
    expect(computeVideoTime(at(2, 13), cutQ1)).toBe(702);
  });

  it("uses the latest of two cuts", () => {
    const two: SyncPoint = { ...cutQ2, cuts: [...cutQ2.cuts!, { period: 2, syncRealWorldTime: T(20), syncVideoTime: 1090 }] };
    expect(computeVideoTime(at(2, 19), two)).toBe(1042);
    expect(computeVideoTime(at(2, 21), two)).toBe(1150);
  });

  it("still places a play without a period by its time", () => {
    expect(computeVideoTime({ realWorldTime: T(18) }, { syncVideoTime: 42, syncRealWorldTime: T(0), cuts: cutQ2.cuts })).toBe(982);
  });
});

describe("syncFromPlayOn", () => {
  it("puts the play where the coach found it, from a lead before it, and leaves earlier plays", () => {
    // The play at 17:48 is found at 980 s in the video (the old sync said 1002). Lead 10 s.
    const next = syncFromPlayOn(base, at(2, 18), 980, 10);
    expect(computeVideoTime(at(2, 18), next)).toBe(980);
    expect(computeVideoTime(at(2, 17, 50), next)).toBe(970);
    expect(computeVideoTime(at(2, 17, 49), next)).toBe(991);
    expect(next.cuts).toEqual([{ period: 2, syncRealWorldTime: T(17, 50), syncVideoTime: 970 }]);
  });

  it("replaces a cut at the same moment instead of stacking another", () => {
    const once = syncFromPlayOn(base, at(2, 18), 980, 10);
    const twice = syncFromPlayOn(once, at(2, 18), 975, 10);
    expect(twice.cuts).toHaveLength(1);
    expect(computeVideoTime(at(2, 18), twice)).toBe(975);
  });

  it("keeps the cuts in time order", () => {
    const late = syncFromPlayOn(base, at(2, 20), 1100, 0);
    const both = syncFromPlayOn(late, at(2, 15), 880, 0);
    expect(both.cuts!.map((c) => c.syncRealWorldTime)).toEqual([T(15), T(20)]);
  });
});

describe("shifting quarters with cuts", () => {
  it("This quarter moves the cuts inside the quarters it moves", () => {
    const moved = shiftPeriod(cutQ2, [], 2, 5);
    expect(moved.cuts).toEqual([{ period: 2, syncRealWorldTime: T(17), syncVideoTime: 927 }]);
  });

  it("This quarter leaves cuts in quarters before it alone", () => {
    const moved = shiftPeriod(cutQ2, [], 3, 5);
    expect(moved.cuts).toEqual(cutQ2.cuts);
  });

  it("This quarter on a quarter that followed a cut keeps the cut's offset", () => {
    // Q3 has no sync of its own and follows the Q2 cut: 922 + 18 min.
    expect(computeVideoTime(at(3, 35), cutQ2)).toBe(2002);
    expect(computeVideoTime(at(3, 35), shiftPeriod(cutQ2, [], 3, 5))).toBe(2007);
  });

  it("This quarter stops at the next quarter with its own sync", () => {
    const q3: SyncPoint = {
      ...base,
      periods: { ...base.periods, "3": { syncVideoTime: 1500, syncRealWorldTime: T(34) } },
      cuts: [
        { period: 2, syncRealWorldTime: T(17), syncVideoTime: 922 },
        { period: 3, syncRealWorldTime: T(40), syncVideoTime: 1800 },
      ],
    };
    expect(shiftPeriod(q3, [], 2, 5).cuts!.map((c) => c.syncVideoTime)).toEqual([927, 1800]);
  });

  it("Whole game moves every cut", () => {
    expect(shiftWholeGame(cutQ2, -3).cuts).toEqual([{ period: 2, syncRealWorldTime: T(17), syncVideoTime: 919 }]);
  });

  it("removing the quarter syncs keeps the cuts", () => {
    expect(clearAllPeriodSyncs(cutQ2).cuts).toEqual(cutQ2.cuts);
  });
});

describe("clearSyncCut", () => {
  it("removes one cut, and the list with the last one", () => {
    const cleared = clearSyncCut(cutQ2, T(17));
    expect(cleared.cuts).toBeUndefined();
    expect(computeVideoTime(at(2, 18), cleared)).toBe(1002);
  });
});

describe("nextFixAfter", () => {
  it("names the next quarter with its own sync, or the next cut, after a moment", () => {
    const q3: SyncPoint = { ...cutQ2, periods: { ...cutQ2.periods, "3": { syncVideoTime: 1500, syncRealWorldTime: T(34) } } };
    expect(nextFixAfter(q3, at(2, 15))).toEqual({ kind: "cut", realWorldTime: T(17) });
    expect(nextFixAfter(q3, at(2, 18))).toEqual({ kind: "period", period: 3 });
    expect(nextFixAfter(q3, at(3, 40))).toBeNull();
  });
});

describe("normalizeSyncPoint with cuts", () => {
  it("drops cuts that can't place a play and sorts the rest", () => {
    const raw = {
      ...base,
      cuts: [
        { period: 2, syncRealWorldTime: T(20), syncVideoTime: 1090 },
        { period: 2, syncRealWorldTime: "not a time", syncVideoTime: 1 },
        { period: 0, syncRealWorldTime: T(18), syncVideoTime: 2 },
        { period: 2, syncRealWorldTime: T(17), syncVideoTime: Number.NaN },
        { period: 2, syncRealWorldTime: T(15), syncVideoTime: 880 },
      ],
    } as SyncPoint;
    expect(normalizeSyncPoint(raw).cuts).toEqual([
      { period: 2, syncRealWorldTime: T(15), syncVideoTime: 880 },
      { period: 2, syncRealWorldTime: T(20), syncVideoTime: 1090 },
    ]);
  });

  it("leaves a sync without cuts as it is", () => {
    expect(normalizeSyncPoint(base)).toEqual(base);
  });
});

describe("firstPlayOfCut", () => {
  it("finds the first play at or after a cut, for the game page to name it", () => {
    const events = [
      { eventId: 1, period: 2, realWorldTime: T(16) },
      { eventId: 2, period: 2, realWorldTime: T(17, 5) },
      { eventId: 3, period: 2, realWorldTime: T(18) },
    ];
    expect(firstPlayOfCut(cutQ2.cuts![0], events)?.eventId).toBe(2);
    expect(firstPlayOfCut({ period: 4, syncRealWorldTime: T(60), syncVideoTime: 0 }, events)).toBeNull();
  });
});

describe("review fixes for cuts", () => {
  it("From this play on moves the play even with an earlier fix just before it", () => {
    // A fix 3 s before this play already exists; this one starts 10 s before the play.
    const once = syncFromPlayOn(base, at(2, 18), 980, 0);
    const near = syncFromPlayOn(once, at(2, 18, 3), 990, 10);
    expect(computeVideoTime(at(2, 18, 3), near)).toBe(990);
  });

  it("This quarter measures the quarter's start without a cut inside that quarter", () => {
    // Q2 has no sync of its own; the league marks its first basket at 17:43.
    // A cut 30 s into Q2 (before that basket) moved later plays 40 s earlier.
    const sync: SyncPoint = {
      syncVideoTime: 42,
      syncRealWorldTime: T(0),
      marks: { "2": { anchor: { realWorldTime: T(13), kind: "first_basket", label: "first basket" } } },
      cuts: [{ period: 2, syncRealWorldTime: T(12, 30), syncVideoTime: 752 }],
    };
    const beforeCut = at(2, 12, 10);
    const afterCut = at(2, 14);
    expect(computeVideoTime(beforeCut, sync)).toBe(772);
    expect(computeVideoTime(afterCut, sync)).toBe(842);
    const moved = shiftPeriod(sync, [], 2, 5);
    expect(computeVideoTime(beforeCut, moved)).toBe(777);
    expect(computeVideoTime(afterCut, moved)).toBe(847);
  });
});

describe("carrySyncOver (re-import)", () => {
  const previous: SyncPoint = { ...cutQ2, breaksCut: true };
  const fresh: SyncPoint = { syncVideoTime: 44, syncRealWorldTime: T(0) };

  it("keeps the quarter syncs and cuts made on the same video", () => {
    expect(carrySyncOver(previous, fresh, true)).toEqual({ ...fresh, periods: previous.periods, cuts: previous.cuts, breaksCut: true });
  });

  it("lets a quarter set again during the re-import win", () => {
    const withQ2 = { ...fresh, periods: { "2": { syncVideoTime: 650, syncRealWorldTime: T(12) } } };
    expect(carrySyncOver(previous, withQ2, true).periods).toEqual(withQ2.periods);
  });

  it("doesn't bring the quarters back once the coach says the video holds the whole game", () => {
    const whole = { ...fresh, breaksCut: false };
    expect(carrySyncOver(previous, whole, true)).toEqual({ ...whole, cuts: previous.cuts });
  });

  it("starts over on another video", () => {
    expect(carrySyncOver(previous, fresh, false)).toEqual(fresh);
  });
});
