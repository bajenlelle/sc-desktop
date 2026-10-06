/**
 * Cases found by the 2026-10-05 spike on real recordings. Each one reproduces a
 * reading pattern a model actually returned and pins the verdict the pipeline
 * must give.
 */
import { describe, expect, it } from "vitest";
import {
  estimateTipoff,
  interpretCoarse,
  narrowVisualWindow,
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

// ── 2026-10-06 first nightly runs ────────────────────────────────────────────
describe("countdown whose tail gets a period-1 label (EOS–Ockelbo, tip at ~365)", () => {
  // The overlay counts down from 05:57 with no period; the model labels its last
  // minutes "1st". The clock then goes blank for the lineup and starts at the tip.
  const readings = [
    c(0, "05:57", null, "pregame"), c(5, "05:53", null, "pregame"), c(10, "05:48", null, "pregame"), c(20, "05:38", null, "pregame"),
    c(30, "05:28", null, "pregame"), c(60, "04:58", null, "pregame"), c(90, "04:28", null, "pregame"), c(120, "03:58", null, "pregame"),
    c(150, "03:28", null, "pregame"), c(180, "02:58", null, "pregame"), c(210, "02:28", null, "pregame"), c(240, "02:01", 1, "pregame"),
    c(270, "01:32", 1, "pregame"), c(300, "01:02", 1, "pregame"), c(330, null, 1, "lineup"), c(360, null, 1, "lineup", true),
    c(390, "09:58", 1, "in_play"), c(420, "09:40", 1, "in_play"), c(450, "09:10", 1, "in_play"), c(480, "08:40", 1, "in_play"),
  ];

  it("opens the fine window where the game clock starts, not inside the countdown", () => {
    expect(interpretCoarse(readings, 9354, { view: "overlay" })).toEqual({ kind: "window", startS: 358, endS: 392, basis: "clock" });
  });
});

describe("a clock that first appears far below 10:00 after a quiet start", () => {
  // Nothing says when the period began, so guessing from the first running
  // reading would put the tip-off minutes off (or before the recording).
  const readings = [
    c(0, null, null, "pregame"), c(5, null, null, "pregame"), c(10, "05:56", 1, "pregame"), c(20, "05:46", 1, "pregame"),
    c(30, "05:36", 1, "pregame"), c(60, "05:06", 1, "pregame"), c(90, "04:36", 1, "pregame"), c(120, "04:06", 1, "pregame"),
  ];

  it("does not open a window there", () => {
    expect(interpretCoarse(readings, 9354, { view: "overlay", sampledToS: 1500 })).toEqual({ kind: "extend", fromS: 1500 });
  });
});

// ── 2026-10-06 first nightly run: broadcasts without a usable clock ──────────
// Two Superettan Herr games came back not_found: one overlay has no game clock at
// all, one shows "1ST 0" for minutes after the tip-off. Both show the score.
const sc = (t: number, clock: string | null, period: number | null, state: TimedReading["state"], score: [number, number] | null, jumpBall: boolean | null = null) =>
  r(t, clock, state, { period, jumpBall, score: score ? { home: score[0], away: score[1] } : null });
const grid = (from: number, to: number, step = 30) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const early = (to: number) => [0, 5, 10, 20, ...grid(30, to)];

describe("no clock in the overlay, an arena clock misread in whole frames (Norrort–Wetterbygden, tip at ~845)", () => {
  // Whole-frame readings as the model returned them: the gym's wall clock shows up as
  // sporadic game-clock readings, and at 1 fps it is read wrongly (4:35 at 868 s).
  const whole = [
    ...early(780).map((t) => sc(t, null, 1, "pregame", [0, 0])),
    sc(810, null, 1, "lineup", [0, 0]), sc(840, null, 1, "lineup", [0, 0], true), sc(870, null, 1, "lineup", [0, 0], true),
    sc(900, "9:34", 1, "in_play", [0, 2]), sc(930, "9:04", 1, "in_play", [2, 4]), sc(960, "8:34", 1, "in_play", [5, 6]), sc(990, "8:32", 1, "stoppage", [7, 6]),
    ...grid(1020, 1500).map((t) => sc(t, null, 1, "in_play", [10, 9])),
  ];
  const fine = [
    sc(868, "4:35", 1, "in_play", [0, 1]), sc(869, "4:34", 1, "in_play", [0, 2]), sc(870, "4:33", 1, "in_play", [0, 2]),
    ...grid(871, 893, 1).map((t) => sc(t, null, 1, "in_play", [2, 2])),
    ...grid(894, 901, 1).map((t) => sc(t, "4:56", 1, "in_play", [2, 4])),
  ];

  it("opens a window that reaches back to the first jump-ball sample", () => {
    expect(interpretCoarse(whole, 7209, { view: "whole" })).toMatchObject({ kind: "window", startS: 838, endS: 902 });
  });

  it("rejects a fine-pass clock estimate that contradicts the window instead of reporting 542.5", () => {
    expect(estimateTipoff(fine, { basisHint: "clock", window: { startS: 868, endS: 902 }, view: "whole" })).toBeNull();
  });

  it("prefers the jump ball over a stray running clock in whole frames", () => {
    const fine2 = [
      ...grid(838, 843, 1).map((t) => sc(t, null, 1, "lineup", [0, 0])),
      sc(844, null, 1, "lineup", [0, 0], true), sc(845, null, 1, "lineup", [0, 0], true),
      ...grid(846, 852, 1).map((t) => sc(t, t === 850 ? "4:35" : null, 1, "in_play", [0, 0])),
    ];
    expect(estimateTipoff(fine2, { basisHint: "clock", window: { startS: 838, endS: 852 }, view: "whole" })).toEqual({ seconds: 845.5, confidence: 0.6, basis: "visual_jump_ball" });
  });

  it("still accepts a first running clock from a scoreboard crop when it fits the window", () => {
    const crops = [...grid(868, 880, 1).map((t) => c(t, null, 1, "unknown")), c(881, "9:58", 1, "unknown"), c(882, "9:57", 1, "unknown")];
    expect(estimateTipoff(crops, { basisHint: "clock", window: { startS: 868, endS: 902 }, view: "overlay" })).toEqual({ seconds: 878.5, confidence: 0.55, basis: "first_running_clock" });
    expect(estimateTipoff(crops, { basisHint: "clock", window: { startS: 1100, endS: 1134 }, view: "overlay" })).toBeNull();
  });
});

describe("score moves while the clock slot is dead (Eskilstuna–Djurgården, tip at ~575)", () => {
  // Whole frames: a pre-game countdown with no period, then "1ST 0" for minutes
  // after the tip-off; the real clock only appears late in the period.
  const p1 = (t: number, clock: string | null, state: TimedReading["state"], score: [number, number] | null, jumpBall: boolean | null = null) => sc(t, clock, 1, state, score, jumpBall);
  const whole = [
    sc(0, "05:59", null, "pregame", [0, 0]), sc(5, "05:55", null, "pregame", [0, 0]), sc(10, "05:51", null, "pregame", [0, 0]), sc(20, "05:43", null, "pregame", [0, 0]),
    sc(30, "05:34", null, "pregame", [0, 0]), sc(60, "05:07", null, "pregame", [0, 0]), sc(90, "04:38", null, "pregame", [0, 0]), sc(120, "04:08", null, "pregame", [0, 0]),
    sc(150, "03:39", null, "pregame", [0, 0]), sc(180, "03:09", null, "pregame", [0, 0]), sc(210, "02:38", null, "pregame", [0, 0]), sc(240, "02:09", null, "pregame", [0, 0]),
    sc(270, null, null, "pregame", null),
    p1(300, null, "pregame", [0, 0]), p1(330, null, "pregame", [0, 0]), p1(360, null, "pregame", [0, 0]), p1(390, "01:31", "pregame", [0, 0]), p1(420, "1", "pregame", [0, 0]),
    p1(450, "0", "lineup", [0, 0]), p1(480, "0", "lineup", [0, 0]), p1(510, "0", "lineup", [0, 0]), p1(540, "0", "lineup", [0, 0]), p1(570, "0", "lineup", [0, 0], true),
    p1(600, null, "in_play", [0, 0]), p1(630, null, "in_play", [0, 0]), p1(660, null, "in_play", [3, 0]), p1(690, null, "in_play", [3, 2]), p1(720, null, "in_play", [3, 3]),
    ...grid(750, 1320).map((t) => p1(t, null, "in_play", [8, 8])),
    p1(1350, "02:22", "in_play", [19, 19]), p1(1380, "01:52", "in_play", [19, 22]), p1(1410, "01:52", "stoppage", [19, 22]), p1(1440, "01:52", "stoppage", [19, 23]),
    p1(1470, "01:44", "in_play", [19, 23]), p1(1500, "01:24", "stoppage", [21, 23]),
  ];

  it("opens the visual window around the jump ball although clocks turn up later", () => {
    expect(interpretCoarse(whole, 8372, { view: "whole" })).toEqual({ kind: "window", startS: 568, endS: 602, basis: "visual" });
  });

  it("falls back to the first scored sample when the states are unreadable", () => {
    const blind = whole.map((x) => (x.t >= 450 && x.t <= 720 ? { ...x, state: "unknown" as const, jumpBall: null } : x));
    expect(interpretCoarse(blind, 8372, { view: "whole" })).toEqual({ kind: "window", startS: 480, endS: 662, basis: "visual" });
  });
});

describe("scoreboard crop with a score but no clock at all", () => {
  const crops = [
    ...early(840).map((t) => sc(t, null, 1, "unknown", [0, 0])),
    sc(870, null, 1, "unknown", [0, 2]), sc(900, null, 1, "unknown", [2, 4]),
    ...grid(930, 1500).map((t) => sc(t, null, 1, "unknown", [14, 9])),
  ];

  it("opens a visual window below the first scored sample instead of asking for whole frames", () => {
    expect(interpretCoarse(crops, 7209, { view: "overlay" })).toEqual({ kind: "window", startS: 690, endS: 872, basis: "visual" });
  });

  it("narrows a long visual window to the jump ball with 5-second whole frames", () => {
    const every5 = grid(690, 872, 5).map((t) => sc(t, null, 1, t < 820 ? "pregame" : t < 850 ? "lineup" : "in_play", [0, 0], t === 840 || t === 845 ? true : null));
    expect(narrowVisualWindow(every5, { startS: 690, endS: 872 })).toEqual({ startS: 838, endS: 852 });
    const noJump = every5.map((x) => ({ ...x, jumpBall: null }));
    expect(narrowVisualWindow(noJump, { startS: 690, endS: 872 })).toEqual({ startS: 843, endS: 852 });
    const noPre = every5.map((x) => ({ ...x, jumpBall: null, state: x.t < 850 ? ("unknown" as const) : x.state }));
    expect(narrowVisualWindow(noPre, { startS: 690, endS: 872 })).toEqual({ startS: 805, endS: 852 });
    const nothing = every5.map((x) => ({ ...x, jumpBall: null, state: "unknown" as const }));
    expect(narrowVisualWindow(nothing, { startS: 690, endS: 872 })).toEqual({ startS: 827, endS: 872 });
  });
});

describe("score guards", () => {
  const blank = (t: number, score: [number, number] | null) => sc(t, null, 1, "unknown", score);

  it("ignores one stray non-zero reading", () => {
    const rs = early(1500).map((t) => blank(t, t === 300 ? [0, 2] : [0, 0]));
    expect(interpretCoarse(rs, 7209, { view: "whole", sampledToS: 1500 })).toEqual({ kind: "extend", fromS: 1500 });
  });

  it("reports a recording that starts after the first basket", () => {
    const rs = early(1500).map((t) => sc(t, null, 1, "in_play", [12 + Math.floor(t / 100), 9]));
    expect(interpretCoarse(rs, 7209, { view: "whole" })).toMatchObject({ kind: "starts_after_tipoff", estimateS: null });
  });

  it("opens a window at the very start when the first points come within the first minute", () => {
    const rs = [blank(0, [0, 0]), blank(5, [0, 0]), blank(10, [0, 0]), blank(20, [0, 0]), blank(30, [2, 0]), blank(60, [2, 2]), ...grid(90, 1500).map((t) => blank(t, [5, 4]))];
    expect(interpretCoarse(rs, 7209, { view: "whole" })).toEqual({ kind: "window", startS: 0, endS: 32, basis: "visual" });
  });

  it("leaves readings without a score alone", () => {
    expect(interpretCoarse(early(1500).map((t) => c(t, null, 1, "unknown")), 7209, { view: "whole", sampledToS: 1500 })).toEqual({ kind: "extend", fromS: 1500 });
  });
});

describe("runTipoffDetection keeps a scoreboard crop that shows a score but no clock", () => {
  const TIP = 845;
  const frame = (t: number): Frame => ({ t, jpegBase64: "x", width: 640, height: 360 });
  const scoreAt = (t: number) => (t < 860 ? { home: 0, away: 0 } : t < 890 ? { home: 0, away: 2 } : { home: 2, away: 4 });
  const cropRead = async (frames: Frame[]): Promise<FrameReading[]> =>
    frames.map((f, index) => ({ index, clockVisible: false, clock: null, clockRunning: null, period: 1, state: "unknown", jumpBall: null, score: scoreAt(f.t) }));
  const wholeRead = async (frames: Frame[]): Promise<FrameReading[]> =>
    frames.map((f, index) => ({
      index,
      clockVisible: false,
      clock: null,
      clockRunning: null,
      period: 1,
      state: f.t < TIP - 30 ? "pregame" : f.t < TIP ? "lineup" : "in_play",
      jumpBall: f.t >= TIP - 1.5 && f.t < TIP ? true : null,
      score: scoreAt(f.t),
    }));

  it("reads the score from crops, then narrows with whole frames and finds the jump ball", async () => {
    const reads: string[] = [];
    const grabs: { view: string; n: number }[] = [];
    const deps: DetectDeps = {
      grab: async (times, o) => {
        grabs.push({ view: o.view, n: times.length });
        return times.map(frame);
      },
      grabRange: async (startS, durationS, fps, o) => {
        const n = Math.floor(durationS * fps) + 1;
        grabs.push({ view: o.view, n });
        return Array.from({ length: n }, (_, i) => frame(startS + i / fps));
      },
      read: async (frames, view) => {
        reads.push(view);
        return view === "overlay" ? cropRead(frames) : wholeRead(frames);
      },
    };
    const res = await runTipoffDetection(7209, deps);
    expect(grabs.map((g) => g.view)).toEqual(["overlay", "overlay", "whole", "whole"]); // region check, crop coarse pass, narrowing, fine pass
    expect(grabs[2].n).toBe(37);
    expect(grabs[3].n).toBeLessThanOrEqual(40);
    expect(reads.filter((v) => v === "whole")).toHaveLength(2);
    expect(res.outcome).toBe("found");
    if (res.outcome !== "found") return;
    expect(Math.abs(res.estimate.seconds - TIP)).toBeLessThanOrEqual(1);
    expect(res.estimate.basis).toBe("visual_jump_ball");
    expect(res.view).toBe("whole");
  });
});
