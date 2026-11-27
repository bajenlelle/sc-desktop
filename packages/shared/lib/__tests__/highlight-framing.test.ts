import { describe, expect, it } from "vitest";
import { cxAt } from "../crop-path";
import {
  gaussianFilter,
  medianFilter,
  needsCheck,
  observationToKeyframes,
  sampleTimes,
  suggestedWindow,
  type ClipObservation,
} from "../highlight-framing";
import spike from "./fixtures/highlight-framing-spike.json";

const CROP_W = (1080 * 9) / 16 / 1920;

function obs(xs: (number | null)[], extra: Partial<ClipObservation> = {}): ClipObservation {
  return {
    frames: xs.map((x, i) => ({ image: i + 1, x, cameraCut: false })),
    releaseImage: null,
    rimX: null,
    madeImage: null,
    identity: "sure",
    note: "",
    ...extra,
  };
}

describe("observationToKeyframes", () => {
  // Claude Opus 5.5's real answers from the 2026-11-27 test, with the keyframes the test's Python made from them.
  for (const c of spike as Array<{ slug: string; shot: boolean; cropW: number; times: number[]; obs: ClipObservation; pythonKeyframes: { t: number; cx: number }[] }>) {
    it(`matches the measured test on ${c.slug}`, () => {
      const kfs = observationToKeyframes(c.times, c.obs, c.cropW, c.shot);
      for (let t = c.times[0]; t <= c.times[c.times.length - 1]; t += 0.1) {
        expect(cxAt(kfs, t)).toBeCloseTo(cxAt(c.pythonKeyframes, t), 2);
      }
    });
  }

  it("bridges frames where the player wasn't seen and holds the ends", () => {
    const times = sampleTimes(10, 12);
    const kfs = observationToKeyframes(times, obs([null, 0.4, null, null, 0.6, null, null, null, null]), CROP_W, false);
    expect(cxAt(kfs, 10)).toBeCloseTo(0.4, 1);
    expect(cxAt(kfs, 12)).toBeCloseTo(0.6, 1);
  });

  it("eases to the rim after the release", () => {
    const times = sampleTimes(0, 3);
    const kfs = observationToKeyframes(times, obs(Array(13).fill(0.5), { releaseImage: 5, rimX: 0.8 }), CROP_W, true);
    expect(cxAt(kfs, 0.5)).toBeCloseTo(0.5, 2);
    expect(cxAt(kfs, 3)).toBeCloseTo(0.8, 2);
  });

  it("doesn't pan to the rim when the play isn't a shot", () => {
    const times = sampleTimes(0, 3);
    const kfs = observationToKeyframes(times, obs(Array(13).fill(0.5), { releaseImage: 5, rimX: 0.8 }), CROP_W, false);
    expect(cxAt(kfs, 3)).toBeCloseTo(0.5, 2);
  });

  it("keeps the window inside the frame", () => {
    const kfs = observationToKeyframes(sampleTimes(0, 1), obs([0.01, 0.01, 0.01, 0.01, 0.01]), CROP_W, false);
    expect(Math.min(...kfs.map((k) => k.cx))).toBeCloseTo(CROP_W / 2, 5);
  });

  it("centres the window when the player is never seen", () => {
    expect(observationToKeyframes([5, 5.25], obs([null, null]), CROP_W, false)).toEqual([{ t: 5, cx: 0.5 }]);
  });
});

describe("helpers", () => {
  it("samples 4 frames a second, capped", () => {
    expect(sampleTimes(1, 2)).toEqual([1, 1.25, 1.5, 1.75, 2]);
    expect(sampleTimes(0, 60)).toHaveLength(44);
  });

  it("filters like scipy at the edges", () => {
    expect(medianFilter([1, 9, 2, 3, 4], 5)).toEqual([1, 2, 3, 4, 4]);
    const g = gaussianFilter([0, 0, 1, 0, 0], 1);
    expect(g.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    expect(g[2]).toBeGreaterThan(g[1]);
  });

  it("suggests a window around the shot", () => {
    const times = sampleTimes(100, 106);
    expect(suggestedWindow(times, obs([], { releaseImage: 17, madeImage: 19 }))).toEqual({ start: 101.5, end: 105.3 });
    expect(suggestedWindow(times, obs([]))).toBeNull();
  });

  it("asks for a look when Claude is unsure or lost the player", () => {
    expect(needsCheck(obs([0.5, 0.5], { identity: "unsure" }), 2)).toBe(true);
    expect(needsCheck(obs([0.5, null, null, 0.5]), 4)).toBe(true);
    expect(needsCheck(obs([0.5, 0.5, 0.5, null]), 4)).toBe(false);
  });
});
