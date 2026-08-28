import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { clipBounds, clipShipKey, computeVideoTime } from "../clip-timing";

function ev(partial: Partial<PlayByPlayEvent>): PlayByPlayEvent {
  return partial as PlayByPlayEvent;
}

const sync: SyncPoint = { syncVideoTime: 120, syncRealWorldTime: "2026-01-01T12:00:00Z" };

describe("computeVideoTime", () => {
  it("offsets from the sync point in seconds", () => {
    expect(computeVideoTime(ev({ realWorldTime: "2026-01-01T12:01:30Z" }), sync)).toBe(210);
  });

  it("lands before the sync video time for earlier events", () => {
    const t = computeVideoTime(ev({ realWorldTime: "2026-01-01T11:59:00Z" }), sync);
    expect(t).toBe(60);
    expect(t!).toBeLessThan(sync.syncVideoTime);
  });

  it("is null when either timestamp is missing or unparseable", () => {
    expect(computeVideoTime(ev({}), sync)).toBeNull();
    expect(
      computeVideoTime(
        ev({ realWorldTime: "2026-01-01T12:01:30Z" }),
        { syncVideoTime: 120, syncRealWorldTime: "" },
      ),
    ).toBeNull();
    expect(computeVideoTime(ev({ realWorldTime: "not a date" }), sync)).toBeNull();
    expect(
      computeVideoTime(
        ev({ realWorldTime: "2026-01-01T12:01:30Z" }),
        { syncVideoTime: 120, syncRealWorldTime: "not a date" },
      ),
    ).toBeNull();
  });
});

describe("clipBounds", () => {
  it("clamps the start at zero", () => {
    expect(clipBounds(2, 5, 3)).toEqual({ start: 0, end: 5 });
  });

  it("adds offsets on both sides", () => {
    expect(clipBounds(100, 5, 3, 2, 4)).toEqual({ start: 93, end: 107 });
  });

  it("defaults offsets to zero", () => {
    expect(clipBounds(100, 5, 3)).toEqual({ start: 95, end: 103 });
  });
});

describe("clipShipKey", () => {
  // GOLDEN: this exact string addresses already-uploaded R2 objects — if it
  // changes, every previously shipped clip is orphaned. Never change these.
  it("formats the R2 object key with one-decimal rolls", () => {
    expect(clipShipKey("m1", 42, 5, 3)).toBe("clips/m1/42_pre5.0_post3.0.mp4");
  });

  it("rounds fractions with toFixed(1) semantics", () => {
    // (5.25).toFixed(1) === "5.3" (tie rounds up); (3.05).toFixed(1) === "3.0"
    // (3.05 is stored below the tie in binary) — both pinned as-is.
    expect(clipShipKey("m1", 7, 5.25, 3.05)).toBe("clips/m1/7_pre5.3_post3.0.mp4");
  });
});
