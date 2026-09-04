import { describe, expect, it } from "vitest";
import type { CropKeyframe } from "../crop-path";
import { clampCx, cropWidthFrac, cxAt, DEFAULT_CX, toSegmentKeyframes } from "../crop-path";

const kf = (t: number, cx: number): CropKeyframe => ({ t, cx });

describe("cxAt", () => {
  it("falls back to the centered default without keyframes", () => {
    expect(cxAt(undefined, 3)).toBe(DEFAULT_CX);
    expect(cxAt([], 3)).toBe(0.5);
  });

  it("holds a single keyframe's cx everywhere", () => {
    const kfs = [kf(5, 0.3)];
    expect(cxAt(kfs, 0)).toBe(0.3);
    expect(cxAt(kfs, 5)).toBe(0.3);
    expect(cxAt(kfs, 100)).toBe(0.3);
  });

  it("clamps to the end values outside the keyframed range", () => {
    const kfs = [kf(10, 0.25), kf(20, 0.75)];
    expect(cxAt(kfs, 0)).toBe(0.25);
    expect(cxAt(kfs, 99)).toBe(0.75);
  });

  it("returns the exact cx at exact keyframe times", () => {
    const kfs = [kf(0, 0.25), kf(10, 0.75), kf(20, 0.5)];
    expect(cxAt(kfs, 0)).toBe(0.25);
    expect(cxAt(kfs, 10)).toBe(0.75);
    expect(cxAt(kfs, 20)).toBe(0.5);
  });

  it("interpolates linearly between keyframes", () => {
    const kfs = [kf(0, 0.25), kf(10, 0.75)];
    expect(cxAt(kfs, 5)).toBe(0.5);
    expect(cxAt(kfs, 2.5)).toBe(0.375);
  });

  it("sorts unsorted input internally without mutating it", () => {
    const kfs = [kf(10, 0.75), kf(0, 0.25)];
    expect(cxAt(kfs, 5)).toBe(0.5);
    expect(kfs.map((k) => k.t)).toEqual([10, 0]);
  });

  it("never divides by zero on duplicate-time keyframes", () => {
    // At the duplicated time the FIRST duplicate wins (interpolation lands
    // exactly on it); past it, the second shapes the path — pinned as-is.
    const kfs = [kf(0, 0.5), kf(5, 0.25), kf(5, 0.75), kf(10, 0.5)];
    expect(cxAt(kfs, 5)).toBe(0.25);
    expect(cxAt(kfs, 7.5)).toBe(0.625);
    // Duplicates alone: at/before → first, after → last.
    const dup = [kf(5, 0.25), kf(5, 0.75)];
    expect(cxAt(dup, 5)).toBe(0.25);
    expect(cxAt(dup, 4)).toBe(0.25);
    expect(cxAt(dup, 6)).toBe(0.75);
  });
});

describe("clampCx", () => {
  // Half-width for a 0.5625-wide window is 0.28125, so the reachable
  // center range is [0.28125, 0.71875].
  it("limits the center by half the window width", () => {
    expect(clampCx(0.1, 0.5625)).toBe(0.28125);
    expect(clampCx(0.95, 0.5625)).toBe(0.71875);
  });

  it("passes centers through while the window stays inside the frame", () => {
    expect(clampCx(0.5, 0.5625)).toBe(0.5);
    expect(clampCx(0.28125, 0.5625)).toBe(0.28125);
    expect(clampCx(0.71875, 0.5625)).toBe(0.71875);
  });

  it("pins the center at 0.5 when the window spans the full frame", () => {
    expect(clampCx(0.1, 1)).toBe(0.5);
    expect(clampCx(0.9, 1.5)).toBe(0.5);
  });
});

describe("cropWidthFrac", () => {
  it("computes the 9:16 window fraction of a 16:9 source's width", () => {
    // (1080 * 9/16) / 1920 = 607.5 / 1920 — the vertical window covers
    // roughly a third of a landscape source's width.
    expect(cropWidthFrac(1920, 1080)).toBe(0.31640625);
  });

  it("caps at 1 for sources already 9:16 or narrower", () => {
    expect(cropWidthFrac(1080, 1920)).toBe(1); // exactly 9:16
    expect(cropWidthFrac(500, 1080)).toBe(1); // narrower than 9:16
  });
});

describe("toSegmentKeyframes", () => {
  it("emits a single centered keyframe when the clip has none", () => {
    expect(toSegmentKeyframes(undefined, 10, 16)).toEqual([{ t: 0, cx: 0.5 }]);
    expect(toSegmentKeyframes([], 10, 16)).toEqual([{ t: 0, cx: 0.5 }]);
  });

  it("shifts inside keyframes to segment time and samples both boundaries", () => {
    const kfs = [kf(12, 0.25), kf(14, 0.75)];
    expect(toSegmentKeyframes(kfs, 10, 16)).toEqual([
      { t: 0, cx: 0.25 }, // boundary sample: hold-before value
      { t: 2, cx: 0.25 },
      { t: 4, cx: 0.75 },
      { t: 6, cx: 0.75 }, // boundary sample: hold-after value
    ]);
  });

  it("collapses out-of-window keyframes onto interpolated boundary values", () => {
    const kfs = [kf(0, 0.2), kf(20, 0.8)];
    const out = toSegmentKeyframes(kfs, 5, 15);
    expect(out.map((k) => k.t)).toEqual([0, 10]);
    expect(out[0].cx).toBe(cxAt(kfs, 5));
    expect(out[1].cx).toBe(cxAt(kfs, 15));
    expect(out[0].cx).toBeCloseTo(0.35, 12);
    expect(out[1].cx).toBeCloseTo(0.65, 12);
  });

  it("sorts unsorted input and anchors first at 0 and last at the duration", () => {
    const kfs = [kf(30, 0.9), kf(2, 0.1), kf(12, 0.5)];
    const out = toSegmentKeyframes(kfs, 10, 20);
    expect(out.map((k) => k.t)).toEqual([0, 2, 10]);
    expect(out[0].cx).toBe(cxAt(kfs, 10));
    expect(out[1]).toEqual({ t: 2, cx: 0.5 });
    expect(out[2].cx).toBe(cxAt(kfs, 20));
  });

  it("keeps one t=0 entry for a keyframe exactly at clipStart", () => {
    // Boundary keyframes are excluded from the inside set (strict > / <);
    // the boundary samples carry their values, so nothing needs deduping.
    const kfs = [kf(10, 0.25), kf(16, 0.75)];
    expect(toSegmentKeyframes(kfs, 10, 16)).toEqual([
      { t: 0, cx: 0.25 },
      { t: 6, cx: 0.75 },
    ]);
  });

  it("dedupes within 1 ms with last write winning", () => {
    // A keyframe 0.5 ms after clipStart merges with the t=0 boundary
    // sample and REPLACES it, so the first entry keeps the keyframe's
    // t (~0.0005) instead of 0 — suspected oddity: the t=0 anchor the
    // boundary sample exists to provide is lost. Pinned as-is.
    const kfs = [kf(5, 0.25), kf(10.0005, 0.75)];
    const out = toSegmentKeyframes(kfs, 10, 16);
    expect(out).toHaveLength(2);
    expect(out[0].t).toBeGreaterThan(0);
    expect(out[0].t).toBeCloseTo(0.0005, 6);
    expect(out[0].cx).toBe(0.75); // the keyframe's cx, not the interpolated boundary value
    expect(out[1]).toEqual({ t: 6, cx: 0.75 });
  });

  it("lets the end boundary sample win over a keyframe just inside clipEnd", () => {
    const kfs = [kf(15.9995, 0.25)];
    expect(toSegmentKeyframes(kfs, 10, 16)).toEqual([
      { t: 0, cx: 0.25 },
      { t: 6, cx: 0.25 }, // t is exactly the duration: boundary replaced the keyframe
    ]);
  });

  it("collapses a zero-duration window to a single entry", () => {
    expect(toSegmentKeyframes([kf(5, 0.25)], 10, 10)).toEqual([{ t: 0, cx: 0.25 }]);
  });
});
