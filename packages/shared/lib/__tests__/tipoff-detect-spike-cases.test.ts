/**
 * Cases found by the 2026-10-05 spike on real recordings. Each one reproduces a
 * reading pattern a model actually returned and pins the verdict the pipeline
 * must give.
 */
import { describe, expect, it } from "vitest";
import {
  estimateTipoff,
  interpretCoarse,
  runTipoffDetection,
  type DetectDeps,
  type Frame,
  type FrameReading,
  type TimedReading,
} from "../tipoff-detect";

const r = (t: number, clock: string | null, state: TimedReading["state"] = "unknown", extra: Partial<TimedReading> = {}): TimedReading => ({
  t,
  index: 0,
  clockVisible: clock != null,
  clock,
  clockRunning: null,
  period: clock != null ? 1 : null,
  state,
  jumpBall: null,
  ...extra,
});

describe("pre-game countdown before the real 10:00 (Fryshuset–Viby, tip at 335.7)", () => {
  const readings = [
    r(0, "4"), r(5, "04:57"), r(10, "04:52"), r(20, "04:42"), r(30, "04:32"), r(60, "04:02"), r(90, "03:32"),
    r(120, "03:02"), r(150, "02:32"), r(180, "02:02", "stoppage"), r(210, "01:32"), r(240, "01:02"), r(270, "32"), r(300, "2"),
    r(330, "10:00", "lineup"), r(360, "09:37", "in_play"), r(390, "09:17", "in_play"), r(420, "08:47", "in_play"),
  ];

  it("is not a recording that starts after the tip-off", () => {
    expect(interpretCoarse(readings, 9301).kind).not.toBe("starts_after_tipoff");
  });

  it("opens the fine window after the 10:00 reset, not inside the countdown", () => {
    expect(interpretCoarse(readings, 9301)).toEqual({ kind: "window", startS: 328, endS: 362, basis: "clock" });
  });
});

describe("overlay whose clock never runs (Örebro–Fryshuset Svart, tip at 1254)", () => {
  const frozenCrops = [0, 5, 10, 20, ...Array.from({ length: 50 }, (_, i) => 30 + i * 30)].map((t) => r(t, "10:00", "pregame"));

  it("asks for whole frames instead of extending the scoreboard-crop pass", () => {
    expect(interpretCoarse(frozenCrops, 7112, { view: "overlay" })).toEqual({ kind: "frozen_clock" });
  });

  it("falls back to the state of play once whole frames are available", () => {
    const whole = frozenCrops.map((x) =>
      x.t < 1140 ? { ...x, state: "pregame" as const } : x.t <= 1230 ? { ...x, state: "lineup" as const } : { ...x, state: "in_play" as const },
    );
    expect(interpretCoarse(whole, 7112, { view: "whole", visualOnly: true })).toEqual({ kind: "window", startS: 1228, endS: 1262, basis: "visual" });
  });

  it("estimates the tip from the last jump-ball frame in a visual window", () => {
    const fine = [r(1250, "10:00", "lineup"), r(1251, "10:00", "lineup"), r(1252, "10:00", "lineup", { jumpBall: true }), r(1253, "10:00", "lineup", { jumpBall: true }), r(1254, "10:00", "in_play"), r(1255, "10:00", "in_play")];
    expect(estimateTipoff(fine, { basisHint: "visual" })).toEqual({ seconds: 1253.5, confidence: 0.6, basis: "visual_jump_ball" });
  });

  it("does not open a visual window on one stray live sample", () => {
    const whole = frozenCrops.map((x) => (x.t === 150 ? { ...x, state: "in_play" as const } : { ...x, state: "pregame" as const }));
    expect(interpretCoarse(whole, 7112, { view: "whole", visualOnly: true, sampledToS: 1500 })).toEqual({ kind: "extend", fromS: 1500 });
  });
});

describe("runTipoffDetection with a frozen overlay", () => {
  const TIP = 1254;
  const frame = (t: number): Frame => ({ t, jpegBase64: "x", width: 640, height: 360 });
  const overlayRead = async (frames: Frame[]): Promise<FrameReading[]> =>
    frames.map((_, index) => ({ index, clockVisible: true, clock: "10:00", clockRunning: null, period: 1, state: "unknown", jumpBall: null }));
  const wholeRead = async (frames: Frame[]): Promise<FrameReading[]> =>
    frames.map((f, index) => ({
      index,
      clockVisible: true,
      clock: "10:00",
      clockRunning: null,
      period: 1,
      state: f.t < TIP - 90 ? "pregame" : f.t < TIP ? "lineup" : "in_play",
      jumpBall: f.t >= TIP - 1.5 && f.t < TIP ? true : null,
    }));

  it("re-samples whole frames and finds the tip visually", async () => {
    const views: string[] = [];
    const deps: DetectDeps = {
      grab: async (times) => times.map(frame),
      grabRange: async (startS, durationS, fps) => Array.from({ length: Math.floor(durationS * fps) + 1 }, (_, i) => frame(startS + i / fps)),
      read: async (frames, view) => {
        views.push(view);
        return view === "overlay" ? overlayRead(frames) : wholeRead(frames);
      },
    };
    const res = await runTipoffDetection(7112, deps);
    expect(res.outcome).toBe("found");
    if (res.outcome !== "found") return;
    expect(Math.abs(res.estimate.seconds - TIP)).toBeLessThanOrEqual(1);
    expect(res.estimate.basis).toBe("visual_jump_ball");
    expect(res.view).toBe("whole");
    expect(views).toContain("whole");
  });
});
