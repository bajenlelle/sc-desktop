import { describe, expect, it } from "vitest";
import { normalizeSyncPoint } from "../period-sync";
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
