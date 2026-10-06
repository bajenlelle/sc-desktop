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

// ── 2026-10-06 BasketTV spike: pre-game countdowns without a period label ─────
// The overlay runs a "Starting 05:54" countdown with no period, then flips to
// period 1. Those early clocks must not pass for a running game clock.
const c = (t: number, clock: string | null, period: number | null, state: TimedReading["state"], jumpBall: boolean | null = null) =>
  r(t, clock, state, { period, jumpBall });

describe("countdown with no period label, then a dead clock (Alvik–AIK, tip at ~370)", () => {
  const readings = [
    c(0, "05:54", null, "pregame"), c(5, "05:49", null, "pregame"), c(10, "05:44", null, "pregame"), c(20, "05:34", null, "pregame"),
    c(30, "05:24", null, "pregame"), c(60, "04:54", null, "pregame"), c(90, "04:24", null, "pregame"), c(120, "03:54", null, "pregame"),
    c(150, "03:24", null, "pregame"), c(180, "02:54", null, "pregame"), c(210, "02:24", null, "pregame"), c(240, null, null, "pregame"),
    c(270, null, 1, "lineup"), c(300, null, 1, "lineup"), c(330, null, 1, "lineup"), c(360, null, 1, "lineup", true),
    c(390, null, 1, "in_play"), c(420, null, 1, "in_play"), c(450, null, 1, "in_play"), c(480, null, 1, "in_play"),
  ];

  it("is not a recording that starts after the tip-off", () => {
    expect(interpretCoarse(readings, 9354, { view: "whole" }).kind).not.toBe("starts_after_tipoff");
  });

  it("falls back to the state of play around the jump ball", () => {
    expect(interpretCoarse(readings, 9354, { view: "whole" })).toEqual({ kind: "window", startS: 358, endS: 392, basis: "visual" });
  });
});

describe("countdown, then an overlay clock stuck at 10:00 (Huddinge–Fryshuset, tip at ~639)", () => {
  const countdown = [0, 5, 10, 20, ...Array.from({ length: 15 }, (_, i) => 30 + i * 30)].map((t) => {
    const left = 589 - t;
    return c(t, `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`, null, "pregame");
  });
  const stuck = Array.from({ length: 35 }, (_, i) => c(480 + i * 30, "10:00", 1, "pregame"));

  it("asks for whole frames instead of extending the scoreboard-crop pass", () => {
    expect(interpretCoarse([...countdown, ...stuck], 9588, { view: "overlay", sampledToS: 1500 })).toEqual({ kind: "frozen_clock" });
  });
});

describe("a recording that starts after the tip-off keeps that verdict", () => {
  it("when the overlay never shows a period label", () => {
    const readings = [
      c(0, "09:45", null, "in_play"), c(5, "09:40", null, "in_play"), c(10, "09:35", null, "in_play"), c(20, "09:25", null, "in_play"),
      c(30, "09:15", null, "stoppage"), c(60, "09:02", null, "in_play"), c(90, "08:41", null, "in_play"), c(120, "08:12", null, "in_play"),
    ];
    expect(interpretCoarse(readings, 8934)).toMatchObject({ kind: "starts_after_tipoff", estimateS: -15 });
  });

  it("when only the very first frame lost its period label", () => {
    const readings = [
      c(0, "09:45", null, "in_play"), c(5, "09:40", 1, "in_play"), c(10, "09:35", 1, "in_play"), c(20, "09:25", 1, "in_play"),
      c(30, "09:15", 1, "stoppage"), c(60, "09:02", 1, "in_play"), c(90, "08:41", 1, "in_play"), c(120, "08:12", 1, "in_play"),
    ];
    expect(interpretCoarse(readings, 8934)).toMatchObject({ kind: "starts_after_tipoff", estimateS: -15 });
  });
});

describe("scoreboard crop with a countdown and then no readable clock at all (Alvik–AIK, second run)", () => {
  // Crop states are guesses (the strip shows no play), so they must not drive a visual window.
  const crops = [
    c(0, "05:54", null, "pregame"), c(5, "05:49", null, "pregame"), c(10, "05:44", null, "pregame"), c(20, "05:34", null, "pregame"),
    c(30, "05:24", null, "pregame"), c(60, "04:54", null, "pregame"), c(90, "04:24", null, "pregame"), c(120, "03:54", null, "pregame"),
    c(150, "03:24", null, "pregame"), c(180, "02:54", null, "pregame"), c(210, "02:24", null, "pregame"), c(240, null, null, "pregame"),
    ...Array.from({ length: 42 }, (_, i) => c(270 + i * 30, null, 1, i < 5 ? "pregame" : "in_play")),
  ];

  it("asks for whole frames instead of guessing from the crop", () => {
    expect(interpretCoarse(crops, 9354, { view: "overlay", sampledToS: 1500 })).toEqual({ kind: "frozen_clock" });
  });

  it("finds the tip visually once the orchestrator has whole frames", async () => {
    const TIP = 370;
    const frame = (t: number): Frame => ({ t, jpegBase64: "x", width: 640, height: 360 });
    // The default-region check (frames at 375/750/1125 s) passes on one flaky
    // reading, as in the real run; the coarse grid never samples 375 s.
    const cropRead = async (frames: Frame[]): Promise<FrameReading[]> =>
      frames.map((f, index) => ({
        index,
        clockVisible: f.t <= 210 || f.t === 375,
        clock: f.t <= 210 ? "05:54" : f.t === 375 ? "10:00" : null,
        clockRunning: null,
        period: f.t <= 210 ? null : 1,
        state: "unknown",
        jumpBall: null,
      }));
    const views: string[] = [];
    const wholeRead = async (frames: Frame[]): Promise<FrameReading[]> =>
      frames.map((f, index) => ({
        index,
        clockVisible: false,
        clock: null,
        clockRunning: null,
        period: f.t <= 240 ? null : 1,
        state: f.t < TIP - 100 ? "pregame" : f.t < TIP ? "lineup" : "in_play",
        jumpBall: f.t >= TIP - 1.5 && f.t < TIP ? true : null,
      }));
    const deps: DetectDeps = {
      grab: async (times) => times.map(frame),
      grabRange: async (startS, durationS, fps) => Array.from({ length: Math.floor(durationS * fps) + 1 }, (_, i) => frame(startS + i / fps)),
      read: async (frames, view) => {
        views.push(view);
        return view === "overlay" ? cropRead(frames) : wholeRead(frames);
      },
    };
    const res = await runTipoffDetection(9354, deps);
    expect(views.slice(0, 2)).toEqual(["overlay", "overlay"]); // region check, then a crop coarse pass
    expect(res.outcome).toBe("found");
    if (res.outcome !== "found") return;
    expect(Math.abs(res.estimate.seconds - TIP)).toBeLessThanOrEqual(1);
    expect(res.estimate.basis).toBe("visual_jump_ball");
    expect(res.view).toBe("whole");
  });
});
