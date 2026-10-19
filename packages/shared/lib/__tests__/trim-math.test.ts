import { describe, expect, it } from "vitest";
import { clipBounds } from "../clip-timing";
import {
  clampTrimEdge,
  formatSeconds,
  offsetsForTrim,
  stepToWhole,
  trimEdgeLimits,
  trimRange,
} from "../trim-math";

describe("trimRange", () => {
  it("shows the clip with ten seconds either side", () => {
    expect(trimRange({ start: 100, end: 113, duration: 3600 })).toEqual({ from: 90, to: 123 });
  });

  it("stops at the ends of the video", () => {
    expect(trimRange({ start: 4, end: 17, duration: 3600 })).toEqual({ from: 0, to: 27 });
    expect(trimRange({ start: 3580, end: 3595, duration: 3600 })).toEqual({ from: 3570, to: 3600 });
  });

  it("works before the duration is known, and never cuts the clip off", () => {
    expect(trimRange({ start: 100, end: 113, duration: null })).toEqual({ from: 90, to: 123 });
    expect(trimRange({ start: 100, end: 113, duration: 110 })).toEqual({ from: 90, to: 113 });
    expect(trimRange({ start: 100, end: 113, duration: Number.NaN })).toEqual({ from: 90, to: 123 });
  });
});

describe("trimEdgeLimits / clampTrimEdge", () => {
  const limits = { eventTime: 110, start: 100, end: 113, duration: 3600 };

  it("keeps the in point between the start of the video and the play", () => {
    expect(trimEdgeLimits("in", limits)).toEqual({ min: 0, max: 110 });
    expect(clampTrimEdge("in", 104.26, limits)).toBe(104.3);
    expect(clampTrimEdge("in", 111, limits)).toBe(110);
    expect(clampTrimEdge("in", -3, limits)).toBe(0);
  });

  it("keeps the out point between the play and the end of the video", () => {
    expect(trimEdgeLimits("out", limits)).toEqual({ min: 110, max: 3600 });
    expect(clampTrimEdge("out", 109, limits)).toBe(110);
    expect(clampTrimEdge("out", 3700, limits)).toBe(3600);
    expect(clampTrimEdge("out", 120.04, limits)).toBe(120);
  });

  it("keeps the clip at least a second long", () => {
    // The play right at the end: the in point can't come within a second of it.
    const late = { eventTime: 113, start: 100, end: 113, duration: 3600 };
    expect(clampTrimEdge("in", 112.8, late)).toBe(112);
    // The play right at the start: neither can the out point.
    const early = { eventTime: 100, start: 100, end: 113, duration: 3600 };
    expect(clampTrimEdge("out", 100.2, early)).toBe(101);
  });

  it("has no upper limit for the out point while the duration is unknown", () => {
    expect(clampTrimEdge("out", 5000, { ...limits, duration: null })).toBe(5000);
  });

  it("holds an unsnapped limit exactly", () => {
    const odd = { eventTime: 110.37, start: 100, end: 113, duration: 3600 };
    expect(clampTrimEdge("in", 110.4, odd)).toBe(110.37);
  });
});

describe("offsetsForTrim", () => {
  it("stores the trim as offsets that clipBounds turns back into it", () => {
    const eventTime = 3721.234;
    const trimmed = { start: 3715.1, end: 3730.6 };
    const o = offsetsForTrim({ eventTime, ...trimmed, preRoll: 10, postRoll: 3 });
    expect(o).toEqual({ preRollOffset: -3.87, postRollOffset: 6.37 });
    const back = clipBounds(eventTime, 10, 3, o.preRollOffset, o.postRollOffset);
    expect(back.start).toBeCloseTo(trimmed.start, 2);
    expect(back.end).toBeCloseTo(trimmed.end, 2);
  });

  it("gives zero offsets for the playlist's own length, never -0", () => {
    const o = offsetsForTrim({ eventTime: 50, start: 40, end: 53, preRoll: 10, postRoll: 3 });
    expect(Object.is(o.preRollOffset, 0)).toBe(true);
    expect(Object.is(o.postRollOffset, 0)).toBe(true);
  });

  it("round-trips a clip that starts at the top of the video", () => {
    const o = offsetsForTrim({ eventTime: 4, start: 0, end: 7, preRoll: 10, postRoll: 3 });
    expect(clipBounds(4, 10, 3, o.preRollOffset, o.postRollOffset)).toEqual({ start: 0, end: 7 });
  });
});

describe("formatSeconds", () => {
  it("shows tenths only when there are any", () => {
    expect(formatSeconds(8.5)).toBe("8.5 s");
    expect(formatSeconds(8.47)).toBe("8.5 s");
    expect(formatSeconds(3)).toBe("3 s");
    expect(formatSeconds(2.999)).toBe("3 s");
    expect(formatSeconds(-0.01)).toBe("0 s");
  });
});

describe("stepToWhole", () => {
  it("steps a whole value by one", () => {
    expect(stepToWhole(8, 9)).toBe(9);
    expect(stepToWhole(8, 7)).toBe(7);
  });

  it("lands a fractional value on the nearest whole second that way", () => {
    expect(stepToWhole(8.47, 9.47)).toBe(9);
    expect(stepToWhole(8.47, 7.47)).toBe(8);
    expect(stepToWhole(0.4, 0)).toBe(0);
  });

  it("isn't thrown by floating-point noise", () => {
    expect(stepToWhole(7.9999999, 8.9999999)).toBe(9);
    expect(stepToWhole(8.0000001, 7.0000001)).toBe(7);
  });

  it("leaves the value when the stepper didn't move", () => {
    expect(stepToWhole(5.5, 5.5)).toBe(5.5);
  });
});
