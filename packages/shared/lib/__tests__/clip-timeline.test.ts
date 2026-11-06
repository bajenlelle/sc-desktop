import { describe, expect, it } from "vitest";
import {
  drawingToShow,
  firedOnPlay,
  holdDue,
  rearm,
  segmentTimeline,
  slowRateAt,
  type SlowRate,
  type SlowSection,
} from "../clip-timeline";

const a = { id: "a", at: 2, hold: 3 };
const b = { id: "b", at: 5, hold: 2 };
const slow = (t: number, length: number, rate: SlowRate): SlowSection => ({ id: `s${t}`, t, length, rate });
const spans = (r: ReturnType<typeof segmentTimeline>) => r.pieces.map((x) => [x.from, x.to, x.speed, x.hold]);

describe("holds in the players", () => {
  it("fires the first unfired drawing whose frame the playhead just reached", () => {
    expect(holdDue([a, b], 2.1, new Set())).toBe(a);
    expect(holdDue([a, b], 2.1, new Set(["a"]))).toBeNull();
    expect(holdDue([a, b], 5.3, new Set(["a"]))).toBe(b);
    expect(holdDue([a, b], 1.9, new Set())).toBeNull();
    expect(holdDue([a], 2.75, new Set())).toBeNull();
  });

  it("rearms fired drawings the playhead went back before", () => {
    expect(rearm([a, b], 1.5, new Set(["a", "b"]))).toEqual(new Set());
    expect(rearm([a, b], 4.5, new Set(["a", "b"]))).toEqual(new Set(["a"]));
  });

  it("a play from a drawing's frame goes on instead of holding it again", () => {
    expect(firedOnPlay([a, b], 2, new Set())).toEqual(new Set(["a"]));
    expect(firedOnPlay([a, b], 1.97, new Set())).toEqual(new Set(["a"])); // the seek landed a hair before the frame
    expect(firedOnPlay([a, b], 2.5, new Set(["b"]))).toEqual(new Set(["a", "b"]));
    expect(firedOnPlay([a, b], 1.9, new Set())).toEqual(new Set()); // before it: it holds when reached
    expect(holdDue([a, b], 2.1, firedOnPlay([a, b], 2, new Set()))).toBeNull();
  });

  it("shows the held drawing, or the one under a paused playhead", () => {
    expect(drawingToShow([a, b], 2.4, "a", false)).toBe(a);
    expect(drawingToShow([a, b], 5.03, null, true)).toBe(b);
    expect(drawingToShow([a, b], 5.2, null, true)).toBeNull();
    expect(drawingToShow([a, b], 5.03, null, false)).toBeNull();
  });
});

describe("slowRateAt", () => {
  it("is the section's rate inside it, 1 elsewhere", () => {
    const s = [{ at: 1, length: 2, rate: 0.5 as const }];
    expect(slowRateAt(s, 1)).toBe(0.5);
    expect(slowRateAt(s, 2.999)).toBe(0.5);
    expect(slowRateAt(s, 3)).toBe(1);
    expect(slowRateAt(s, 0.5)).toBe(1);
    expect(slowRateAt([], 1)).toBe(1);
  });
});

describe("segmentTimeline", () => {
  it("no effects, no pieces", () => {
    expect(segmentTimeline([], [], 10, 14)).toEqual({ pieces: [], windows: [], duration: 4 });
  });

  it("a lone hold splits the segment and its window ends a millisecond early", () => {
    const r = segmentTimeline([{ id: "a", t: 11, hold: 2 }], [], 10, 14);
    expect(r.pieces).toEqual([
      { from: 0, to: 1, speed: 1, hold: 2, drawingId: "a" },
      { from: 1, to: 4, speed: 1, hold: 0 },
    ]);
    expect(r.windows.map((w) => [w.drawing.id, w.from, w.to])).toEqual([["a", 1, 2.999]]);
    expect(r.duration).toBe(6);
  });

  it("a slow section stretches its piece", () => {
    const r = segmentTimeline([], [slow(10.5, 0.5, 0.5)], 10, 14);
    expect(spans(r)).toEqual([[0, 0.5, 1, 0], [0.5, 1, 0.5, 0], [1, 4, 1, 0]]);
    expect(r.duration).toBe(4.5);
  });

  it("slow into a freeze: the section's end snaps to the frame and the window follows the stretch", () => {
    const r = segmentTimeline([{ id: "a", t: 11, hold: 2 }], [slow(10.5, 0.45, 0.5)], 10, 14);
    expect(spans(r)).toEqual([[0, 0.5, 1, 0], [0.5, 1, 0.5, 2], [1, 4, 1, 0]]);
    expect(r.windows.map((w) => [w.from, w.to])).toEqual([[1.5, 3.499]]);
    expect(r.duration).toBe(6.5);
  });

  it("a freeze inside a slow section splits it", () => {
    const r = segmentTimeline([{ id: "a", t: 11, hold: 2 }], [slow(10.5, 1.5, 0.5)], 10, 14);
    expect(spans(r)).toEqual([[0, 0.5, 1, 0], [0.5, 1, 0.5, 2], [1, 2, 0.5, 0], [2, 4, 1, 0]]);
    expect(r.windows.map((w) => [w.from, w.to])).toEqual([[1.5, 3.499]]);
    expect(r.duration).toBe(7.5);
  });

  it("quarter speed quadruples", () => {
    expect(segmentTimeline([], [slow(11, 1, 0.25)], 10, 14).duration).toBe(7);
  });

  it("clips sections to the segment and drops drawings outside the margins", () => {
    const r = segmentTimeline(
      [{ id: "x", t: 10.05, hold: 4 }, { id: "y", t: 13.95, hold: 4 }],
      [slow(9, 2, 0.5), slow(13.5, 2, 0.5)],
      10,
      14,
    );
    expect(spans(r)).toEqual([[0, 1, 0.5, 0], [1, 3.5, 1, 0], [3.5, 4, 0.5, 0]]);
    expect(r.windows).toEqual([]);
    expect(r.duration).toBe(5.5);
  });

  it("an overlapping section starts where the earlier one ends; a sliver is dropped; a small gap closes", () => {
    expect(spans(segmentTimeline([], [slow(11, 2, 0.5), slow(12, 1.05, 0.25)], 10, 14))).toEqual([
      [0, 1, 1, 0],
      [1, 3, 0.5, 0],
      [3, 4, 1, 0],
    ]);
    expect(spans(segmentTimeline([], [slow(11, 1, 0.5), slow(12.05, 1, 0.25)], 10, 14))).toEqual([
      [0, 1, 1, 0],
      [1, 2.05, 0.5, 0],
      [2.05, 3.05, 0.25, 0],
      [3.05, 4, 1, 0],
    ]);
  });

  it("a section that covers the whole segment is one piece", () => {
    const r = segmentTimeline([], [slow(9, 6, 0.5)], 10, 14);
    expect(spans(r)).toEqual([[0, 4, 0.5, 0]]);
    expect(r.duration).toBe(8);
  });

  it("rounds to milliseconds, clamps holds and drops a drawing within 0.05 s of the previous, without touching the input", () => {
    const ds = [
      { id: "c", t: 13, hold: 30 },
      { id: "a", t: 11.0004, hold: 0.5 },
      { id: "b", t: 11.04, hold: 4 },
    ];
    const r = segmentTimeline(ds, [], 10, 14);
    expect(r.pieces.map((x) => [x.from, x.to, x.hold])).toEqual([[0, 1, 1], [1, 3, 10], [3, 4, 0]]);
    expect(r.windows.map((w) => [w.drawing.id, w.from, w.to])).toEqual([["a", 1, 1.999], ["c", 4, 13.999]]);
    expect(r.duration).toBe(15);
    expect(ds[0].id).toBe("c");
  });
});
