import { describe, expect, it } from "vitest";
import { clipBounds } from "../clip-timing";
import {
  clampTrimEdge,
  describeTrim,
  formatSeconds,
  offsetsForTrim,
  slideWindow,
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
  const limits = { start: 100, end: 113, duration: 3600 };

  it("lets the in point go anywhere from the start of the video to a second before the out point", () => {
    expect(trimEdgeLimits("in", limits)).toEqual({ min: 0, max: 112 });
    expect(clampTrimEdge("in", 104.26, limits)).toBe(104.3);
    expect(clampTrimEdge("in", 111, limits)).toBe(111);
    expect(clampTrimEdge("in", 112.8, limits)).toBe(112);
    expect(clampTrimEdge("in", -3, limits)).toBe(0);
  });

  it("lets the out point go anywhere from a second after the in point to the end of the video", () => {
    expect(trimEdgeLimits("out", limits)).toEqual({ min: 101, max: 3600 });
    expect(clampTrimEdge("out", 100.2, limits)).toBe(101);
    expect(clampTrimEdge("out", 3700, limits)).toBe(3600);
    expect(clampTrimEdge("out", 120.04, limits)).toBe(120);
  });

  it("puts no play in the way: a clip can end before it or start after it", () => {
    // A play logged at 130 whose footage is at 100–113: the out point stays
    // where it is, well before the play.
    expect(clampTrimEdge("out", 108, limits)).toBe(108);
    expect(clampTrimEdge("in", 112, { start: 100, end: 140, duration: 3600 })).toBe(112);
  });

  it("has no upper limit for the out point while the duration is unknown", () => {
    expect(clampTrimEdge("out", 5000, { ...limits, duration: null })).toBe(5000);
  });

  it("holds an unsnapped limit exactly", () => {
    const odd = { start: 100, end: 111.37, duration: 3600 };
    expect(clampTrimEdge("in", 110.4, odd)).toBe(110.37);
  });
});

describe("slideWindow", () => {
  it("moves both ends and keeps the length", () => {
    expect(slideWindow({ start: 100, end: 113 }, -15, 3600)).toEqual({ start: 85, end: 98 });
    const w = slideWindow({ start: 100.03, end: 112.5 }, 4.21, 3600);
    expect(w.start).toBe(104.2);
    expect(w.end - w.start).toBeCloseTo(12.47, 10);
  });

  it("stops at the start of the video", () => {
    expect(slideWindow({ start: 6, end: 19 }, -15, 3600)).toEqual({ start: 0, end: 13 });
  });

  it("stops at the end of the video, and only there while the duration is unknown", () => {
    expect(slideWindow({ start: 3580, end: 3593 }, 15, 3600)).toEqual({ start: 3587, end: 3600 });
    expect(slideWindow({ start: 3580, end: 3593 }, 15, null)).toEqual({ start: 3595, end: 3608 });
  });

  it("keeps a clip longer than the video at its start", () => {
    expect(slideWindow({ start: 2, end: 40 }, 5, 30)).toEqual({ start: 0, end: 38 });
  });
});

describe("describeTrim", () => {
  it("says how much plays before and after a play inside the clip", () => {
    expect(describeTrim({ eventTime: 110, start: 105, end: 113.5 })).toBe("5 s before, 3.5 s after");
  });

  it("says how far before the play a clip ends", () => {
    expect(describeTrim({ eventTime: 130, start: 111, end: 124 })).toBe("ends 6 s before the play");
  });

  it("says how far after the play a clip starts", () => {
    expect(describeTrim({ eventTime: 100, start: 104, end: 117 })).toBe("starts 4 s after the play");
  });

  it("counts an end on the play, or within a twentieth of it, as containing it", () => {
    expect(describeTrim({ eventTime: 110, start: 100, end: 110 })).toBe("10 s before, 0 s after");
    expect(describeTrim({ eventTime: 110, start: 110, end: 113 })).toBe("0 s before, 3 s after");
    expect(describeTrim({ eventTime: 110, start: 100, end: 109.96 })).toBe("10 s before, 0 s after");
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

  it("stores a clip trimmed off its play as negative totals that clipBounds turns back into it", () => {
    // Logged at 130, the footage is at 111–124: the clip ends 6 s before the play.
    const o = offsetsForTrim({ eventTime: 130, start: 111, end: 124, preRoll: 10, postRoll: 3 });
    expect(o).toEqual({ preRollOffset: 9, postRollOffset: -9 });
    expect(clipBounds(130, 10, 3, o.preRollOffset, o.postRollOffset)).toEqual({ start: 111, end: 124 });
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

  it("writes a negative with a minus sign", () => {
    expect(formatSeconds(-4)).toBe("\u22124 s");
    expect(formatSeconds(-2.46)).toBe("\u22122.5 s");
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

  it("steps below zero the same way", () => {
    expect(stepToWhole(-4.5, -3.5)).toBe(-4);
    expect(stepToWhole(-4.5, -5.5)).toBe(-5);
    expect(stepToWhole(0, -1)).toBe(-1);
  });

  it("isn't thrown by floating-point noise", () => {
    expect(stepToWhole(7.9999999, 8.9999999)).toBe(9);
    expect(stepToWhole(8.0000001, 7.0000001)).toBe(7);
  });

  it("leaves the value when the stepper didn't move", () => {
    expect(stepToWhole(5.5, 5.5)).toBe(5.5);
  });
});
