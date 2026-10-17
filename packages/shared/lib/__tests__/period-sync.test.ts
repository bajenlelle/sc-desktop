import { describe, expect, it } from "vitest";
import { computeVideoTime } from "../clip-timing";
import {
  clearAllPeriodSyncs,
  clearPeriodSync,
  describePeriodSyncs,
  normalizeSyncPoint,
  periodMarksFromEvents,
  predictPeriodAnchor,
  setPeriodSync,
  shiftPeriod,
  shiftWholeGame,
  videoLooksCut,
  type PeriodEvent,
} from "../period-sync";
import type { SyncPoint } from "../../types/match";

describe("normalizeSyncPoint", () => {
  const q1 = { syncVideoTime: 42, syncRealWorldTime: "2026-09-20T17:30:00Z" };

  it("leaves a plain sync point as it is", () => {
    expect(normalizeSyncPoint(q1)).toEqual(q1);
  });

  it("keeps good period syncs and drops ones that can't place a play", () => {
    const raw = {
      ...q1,
      periods: {
        "2": { syncVideoTime: 642, syncRealWorldTime: "2026-09-20T17:42:00Z" },
        "1": { syncVideoTime: 9, syncRealWorldTime: "2026-09-20T17:30:00Z" },
        "3": { syncVideoTime: Number.NaN, syncRealWorldTime: "2026-09-20T18:04:00Z" },
        "4": { syncVideoTime: 2000, syncRealWorldTime: "not a time" },
        x: { syncVideoTime: 1, syncRealWorldTime: "2026-09-20T18:04:00Z" },
      },
    } as SyncPoint;
    expect(normalizeSyncPoint(raw).periods).toEqual({
      "2": { syncVideoTime: 642, syncRealWorldTime: "2026-09-20T17:42:00Z" },
    });
  });

  it("drops an empty or unusable periods map altogether", () => {
    expect("periods" in normalizeSyncPoint({ ...q1, periods: {} })).toBe(false);
    expect("periods" in normalizeSyncPoint({ ...q1, periods: null } as unknown as SyncPoint)).toBe(false);
  });

  it("keeps marks with a usable anchor, and only their valid start and end", () => {
    const raw = {
      ...q1,
      marks: {
        "2": {
          startRealWorldTime: "2026-09-20T17:42:00Z",
          endRealWorldTime: "garbage",
          anchor: { realWorldTime: "2026-09-20T17:42:40Z", kind: "first_basket", label: "Lidingö's first basket of Q2 (18–15)" },
        },
        "3": { anchor: { realWorldTime: "nope", kind: "period_start", label: "Start of Q3" } },
      },
    } as SyncPoint;
    expect(normalizeSyncPoint(raw).marks).toEqual({
      "2": {
        startRealWorldTime: "2026-09-20T17:42:00Z",
        anchor: { realWorldTime: "2026-09-20T17:42:40Z", kind: "first_basket", label: "Lidingö's first basket of Q2 (18–15)" },
      },
    });
  });

  it("drops a breaksCut that isn't a boolean", () => {
    expect(normalizeSyncPoint({ ...q1, breaksCut: true }).breaksCut).toBe(true);
    expect("breaksCut" in normalizeSyncPoint({ ...q1, breaksCut: "yes" } as unknown as SyncPoint)).toBe(false);
  });
});

// A game whose video skips every break. Wall clock: Q1 17:30–17:52, Q2
// 17:54–18:16, halftime, Q3 18:26–18:46, Q4 18:48–19:08. In the video the
// tip-off is at 0:42 and each quarter starts where the last one ended, so the
// first baskets (30, 30, 40 and 15 s in) sit at 72, 1392, 2722 and 3897 s.
const T = (hms: string) => `2026-09-20T${hms}Z`;
const team = (name: string) => ({ teamCode: "", teamName: name, teamNumber: 1 });
const play = (period: number, hms: string, made = false, score?: [number, number]): PeriodEvent => ({
  period,
  realWorldTime: T(hms),
  type: made ? "2pt" : "rebound",
  isSuccessful: made ? 1 : 0,
  eventTeam: team("Lidingö"),
  scoreHome: score?.[0] ?? null,
  scoreAway: score?.[1] ?? null,
});
const events: PeriodEvent[] = [
  play(1, "17:30:30", true, [2, 0]), play(1, "17:51:50"),
  play(2, "17:54:30", true, [20, 15]), play(2, "18:15:55"),
  play(3, "18:26:40", true, [40, 33]), play(3, "18:45:58"),
  play(4, "18:48:15", true, [55, 50]), play(4, "19:07:59"),
];
const marks: SyncPoint["marks"] = {
  "1": { startRealWorldTime: T("17:30:00"), endRealWorldTime: T("17:52:00"), anchor: { realWorldTime: T("17:30:00"), kind: "period_start", label: "Start of Q1 (clock 10:00)" } },
  "2": { startRealWorldTime: T("17:54:00"), endRealWorldTime: T("18:16:00"), anchor: { realWorldTime: T("17:54:30"), kind: "first_basket", label: "Lidingö's first basket of Q2 (20–15)" } },
  "3": { startRealWorldTime: T("18:26:00"), endRealWorldTime: T("18:46:00"), anchor: { realWorldTime: T("18:26:40"), kind: "first_basket", label: "Lidingö's first basket of Q3 (40–33)" } },
  "4": { startRealWorldTime: T("18:48:00"), endRealWorldTime: T("19:08:00"), anchor: { realWorldTime: T("18:48:15"), kind: "first_basket", label: "Lidingö's first basket of Q4 (55–50)" } },
};
const q1: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: T("17:30:00"), marks };
const TRUE_ANCHOR: Record<number, number> = { 2: 1392, 3: 2722, 4: 3897 };

describe("videoLooksCut", () => {
  it("flags a video the play-by-play runs well past", () => {
    const r = videoLooksCut({ durationSeconds: 5100, events, sync: q1 });
    expect(r.cut).toBe(true);
    expect(Math.round(r.overrunSeconds)).toBe(821);
    expect(r.breakSeconds).toBe(840);
  });

  it("leaves a video that holds the whole game alone", () => {
    expect(videoLooksCut({ durationSeconds: 5950, events, sync: q1 }).cut).toBe(false);
  });

  it("says nothing without a duration", () => {
    expect(videoLooksCut({ durationSeconds: null, events, sync: q1 }).cut).toBe(false);
  });
});

describe("predictPeriodAnchor", () => {
  it("predicts each quarter within ten seconds from the league's period times, chaining unset quarters", () => {
    for (const p of [2, 3, 4]) {
      const at = predictPeriodAnchor(q1, events, p)!;
      expect(Math.abs(at - TRUE_ANCHOR[p])).toBeLessThanOrEqual(15);
    }
    expect(Math.abs(predictPeriodAnchor(q1, events, 2)! - 1392)).toBeLessThanOrEqual(5);
  });

  it("gets closer once the quarter before is set", () => {
    const q2Set = setPeriodSync(q1, 2, 1392, marks["2"].anchor);
    expect(Math.abs(predictPeriodAnchor(q2Set, events, 3)! - 2722)).toBeLessThanOrEqual(5);
  });

  it("ignores the quarter's own sync, so the suggestion survives setting it", () => {
    const q3Set = setPeriodSync(q1, 3, 2000, marks["3"].anchor);
    expect(predictPeriodAnchor(q3Set, events, 3)).toBe(predictPeriodAnchor(q1, events, 3));
  });

  it("still predicts from the plays alone for a game imported without period times", () => {
    const old: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: T("17:30:00") };
    expect(Math.abs(predictPeriodAnchor(old, events, 2)! - 1392)).toBeLessThanOrEqual(60);
  });

  it("has nothing to predict for Q1", () => {
    expect(predictPeriodAnchor(q1, events, 1)).toBeNull();
  });
});

describe("describePeriodSyncs", () => {
  it("lists Q2 onward with what each follows, where it is and where it should be", () => {
    const sync = setPeriodSync(q1, 2, 1392, marks["2"].anchor);
    const rows = describePeriodSyncs(sync, events);
    expect(rows.map((r) => [r.name, r.set, r.follows])).toEqual([
      ["Q2", true, 1],
      ["Q3", false, 2],
      ["Q4", false, 2],
    ]);
    expect(rows[0].videoTime).toBe(1392);
    expect(rows[0].anchor?.label).toBe("Lidingö's first basket of Q2 (20–15)");
    expect(Math.abs(rows[1].suggested! - 2722)).toBeLessThanOrEqual(5);
  });
});

describe("period edits", () => {
  const anchor2 = marks["2"].anchor;

  it("setPeriodSync places a quarter on its anchor; period 1 moves the game's sync point", () => {
    const s = setPeriodSync(q1, 2, 1392, anchor2);
    expect(s.periods!["2"]).toEqual({ syncVideoTime: 1392, syncRealWorldTime: anchor2.realWorldTime, anchor: { kind: "first_basket", label: anchor2.label } });
    expect(setPeriodSync(q1, 1, 50, anchor2)).toMatchObject({ syncVideoTime: 50, syncRealWorldTime: q1.syncRealWorldTime });
  });

  it("clearPeriodSync lets a quarter follow again, dropping an empty map", () => {
    const s = clearPeriodSync(setPeriodSync(q1, 2, 1392, anchor2), 2);
    expect("periods" in s).toBe(false);
  });

  it("shiftPeriod moves a set quarter, and gives an unset one its own sync on its anchor", () => {
    const set = setPeriodSync(q1, 2, 1392, anchor2);
    expect(shiftPeriod(set, events, 2, -3).periods!["2"].syncVideoTime).toBe(1389);
    const fresh = shiftPeriod(q1, events, 3, -660);
    // Q3's anchor at 18:26:40 maps to 42 + 3400 = 3442 with Q1's sync; moved 660 s earlier.
    expect(fresh.periods!["3"]).toMatchObject({ syncVideoTime: 2782, syncRealWorldTime: T("18:26:40") });
    // Q4 follows Q3 now; Q1 and Q2 stay.
    expect(computeVideoTime(play(4, "18:48:15"), fresh)).toBe(2782 + 1295);
    expect(computeVideoTime(play(2, "17:54:30"), fresh)).toBe(1512);
  });

  it("shiftPeriod on Q1 keeps the reference event, as the game page does", () => {
    expect(shiftPeriod(q1, events, 1, 2)).toMatchObject({ syncVideoTime: 44, syncRealWorldTime: q1.syncRealWorldTime });
  });

  it("shiftWholeGame moves every quarter", () => {
    const s = shiftWholeGame(setPeriodSync(q1, 3, 2722, marks["3"].anchor), 4);
    expect(s.syncVideoTime).toBe(46);
    expect(s.periods!["3"].syncVideoTime).toBe(2726);
  });

  it("clearAllPeriodSyncs puts the game back on Q1 alone", () => {
    expect("periods" in clearAllPeriodSyncs(setPeriodSync(q1, 2, 1392, anchor2))).toBe(false);
  });
});

describe("periodMarksFromEvents", () => {
  it("anchors each period on its first made basket, with the team and score", () => {
    const m = periodMarksFromEvents(events);
    expect(m["3"].anchor).toEqual({ realWorldTime: T("18:26:40"), kind: "first_basket", label: "Lidingö's first basket of Q3 (40–33)" });
    expect(m["2"].startRealWorldTime).toBeUndefined();
  });

  it("falls back to the first play when nobody scored, and says OT", () => {
    const m = periodMarksFromEvents([play(5, "19:15:00"), play(5, "19:16:00")]);
    expect(m["5"].anchor).toEqual({ realWorldTime: T("19:15:00"), kind: "play", label: "The first play of OT1" });
  });
});
