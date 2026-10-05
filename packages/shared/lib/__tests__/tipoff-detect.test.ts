import { describe, expect, it } from "vitest";
import {
  DETECT,
  coarseSchedule,
  estimateTipoff,
  fineSchedule,
  interpretCoarse,
  isWarmupCountdown,
  parseClock,
  runTipoffDetection,
  type DetectDeps,
  type Frame,
  type FrameReading,
  type TimedReading,
} from "../tipoff-detect";

const reading = (t: number, clock: string | null, extra: Partial<TimedReading> = {}): TimedReading => ({
  t,
  index: 0,
  clockVisible: clock != null,
  clock,
  clockRunning: null,
  period: clock != null ? 1 : null,
  state: clock != null ? "in_play" : "pregame",
  jumpBall: null,
  ...extra,
});

describe("parseClock", () => {
  it.each([
    ["10:00", 600],
    ["9:58", 598],
    ["09:58", 598],
    ["0:45.3", 45.3],
    ["0:45,3", 45.3],
    [" 10:00 ", 600],
  ])("parses %s", (text, expected) => {
    expect(parseClock(text)).toBe(expected);
  });

  it.each([null, "", "24", "14", "1:02:03", "ten", "10:0"])("rejects %s", (text) => {
    expect(parseClock(text)).toBeNull();
  });
});

describe("coarseSchedule", () => {
  it("samples densely at the start, then every 30 s, within the window", () => {
    const s = coarseSchedule(7112);
    expect(s.slice(0, 6)).toEqual([0, 5, 10, 20, 30, 60]);
    expect(s.at(-1)).toBe(DETECT.coarseWindowS);
    expect(new Set(s).size).toBe(s.length);
  });

  it("stays inside a short recording", () => {
    expect(coarseSchedule(100)).toEqual([0, 5, 10, 20, 30, 60, 90]);
  });

  it("continues from an earlier window without the early samples", () => {
    const s = coarseSchedule(7112, 1500, 2400);
    expect(s[0]).toBe(1500);
    expect(s.at(-1)).toBe(2400);
    expect(s).not.toContain(0);
  });
});

describe("isWarmupCountdown", () => {
  it("recognises a clock falling at wall-clock rate from above 10:00", () => {
    const rs = [reading(0, "14:30"), reading(30, "14:00"), reading(60, "13:30"), reading(90, "13:00")];
    expect(isWarmupCountdown(rs)).toBe(true);
  });

  it("does not flag a game clock that stalls at 10:00", () => {
    const rs = [reading(0, "10:00"), reading(30, "10:00"), reading(60, "10:00"), reading(90, "9:41")];
    expect(isWarmupCountdown(rs)).toBe(false);
  });
});

describe("interpretCoarse", () => {
  it("opens a fine window around the first drop below 10:00 after a stall", () => {
    const rs = [reading(0, null), reading(30, "10:00"), reading(60, "10:00"), reading(90, "10:00"), reading(120, "9:41")];
    expect(interpretCoarse(rs, 7112)).toEqual({ kind: "window", startS: 88, endS: 122, basis: "clock" });
  });

  it("reports a recording that starts after the tip-off with an estimate", () => {
    const rs = [reading(0, "9:45"), reading(5, "9:40"), reading(10, "9:35")];
    expect(interpretCoarse(rs, 8934)).toMatchObject({ kind: "starts_after_tipoff", estimateS: -15, firstClock: "9:45" });
  });

  it("gives no estimate when the recording starts in a later period", () => {
    const rs = [reading(0, "7:12", { period: 2 }), reading(5, "7:07", { period: 2 })];
    expect(interpretCoarse(rs, 8934)).toMatchObject({ kind: "starts_after_tipoff", estimateS: null });
  });

  it("ignores a warm-up countdown crossing 10:00", () => {
    const rs = [reading(0, "11:00"), reading(30, "10:30"), reading(60, "10:00"), reading(90, "9:30"), reading(120, "9:00")];
    const v = interpretCoarse(rs, 7112, { sampledToS: 1500 });
    expect(v.kind).toBe("extend");
  });

  it("falls back to the state of play when no clock is ever visible", () => {
    const rs = [reading(0, null), reading(30, null, { state: "lineup" }), reading(60, null, { state: "in_play" })];
    expect(interpretCoarse(rs, 7112)).toEqual({ kind: "window", startS: 28, endS: 62, basis: "visual" });
  });

  it("asks to extend when nothing happened yet, and gives up at the cap", () => {
    const quiet = [reading(0, null), reading(600, null), reading(1500, "10:00")];
    expect(interpretCoarse(quiet, 7112, { sampledToS: 1500 })).toEqual({ kind: "extend", fromS: 1500 });
    expect(interpretCoarse(quiet, 7112, { sampledToS: DETECT.coarseMaxS })).toEqual({ kind: "not_found" });
    expect(interpretCoarse(quiet, 1501, { sampledToS: 1500 })).toEqual({ kind: "not_found" });
  });
});

describe("fineSchedule", () => {
  it("produces one time per second across the window, inclusive", () => {
    expect(fineSchedule({ startS: 88, endS: 122 })).toHaveLength(35);
    expect(fineSchedule({ startS: 88, endS: 122 })[0]).toBe(88);
  });
});

describe("estimateTipoff", () => {
  it("places the start half a second before the first sub-10:00 reading minus elapsed", () => {
    const fine = [reading(100, "10:00"), reading(101, "10:00"), reading(102, "9:59")];
    expect(estimateTipoff(fine)).toEqual({ seconds: 100.5, confidence: 0.92, basis: "clock_transition" });
  });

  it("lowers confidence when the previous 10:00 reading is far away", () => {
    const fine = [reading(100, "10:00"), reading(104, null), reading(110, "9:52")];
    const e = estimateTipoff(fine);
    expect(e?.seconds).toBe(101.5);
    expect(e?.confidence).toBeLessThan(0.92);
  });

  it("returns null when the clock never leaves 10:00", () => {
    expect(estimateTipoff([reading(100, "10:00"), reading(101, "10:00")])).toBeNull();
  });

  it("uses the first live frame after a lineup when asked for a visual basis", () => {
    const fine = [reading(50, null, { state: "lineup" }), reading(51, null, { state: "lineup" }), reading(52, null, { state: "in_play" })];
    expect(estimateTipoff(fine, { basisHint: "visual" })).toEqual({ seconds: 52, confidence: 0.4, basis: "visual_play_start" });
  });
});

describe("runTipoffDetection", () => {
  // A synthetic game: scoreboard visible everywhere, clock stalls at 10:00 and starts at t = 1254.
  const TIP = 1254;
  const clockAt = (t: number): string => {
    if (t < TIP) return "10:00";
    const left = 600 - Math.floor(t - TIP);
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  };
  const frame = (t: number): Frame => ({ t, jpegBase64: "x", width: 640, height: 96 });
  const read = async (frames: Frame[]): Promise<FrameReading[]> =>
    frames.map((f, index) => ({ index, clockVisible: true, clock: clockAt(f.t), clockRunning: null, period: 1, state: "in_play", jumpBall: null }));

  function deps(overrides: Partial<DetectDeps> = {}): DetectDeps & { calls: { view: string; n: number }[] } {
    const calls: { view: string; n: number }[] = [];
    return {
      calls,
      grab: async (times) => times.map(frame),
      grabRange: async (startS, durationS, fps) => fineSchedule({ startS, endS: startS + durationS }, fps).map(frame),
      read: async (frames, view) => {
        calls.push({ view, n: frames.length });
        return read(frames);
      },
      locate: async () => null,
      ...overrides,
    };
  }

  it("finds the tip-off through locate → coarse → fine with the overlay crop", async () => {
    const d = deps();
    const r = await runTipoffDetection(7112, d);
    expect(r.outcome).toBe("found");
    if (r.outcome !== "found") return;
    expect(Math.abs(r.estimate.seconds - TIP)).toBeLessThanOrEqual(1);
    expect(d.calls.every((c) => c.n <= DETECT.maxFramesPerCall)).toBe(true);
    expect(d.calls.every((c) => c.view === "overlay")).toBe(true);
    expect(r.stats.apiCalls).toBe(d.calls.length);
  });

  it("falls back to whole frames when the crop never shows a clock", async () => {
    let first = true;
    const d = deps({
      read: async (frames, view) => {
        if (view === "overlay" && first) {
          first = false;
          return frames.map((_, index) => ({ index, clockVisible: false, clock: null, clockRunning: null, period: null, state: "unknown" as const, jumpBall: null }));
        }
        return read(frames);
      },
    });
    const r = await runTipoffDetection(7112, d);
    expect(r.outcome).toBe("found");
  });

  it("stops with cancelled when aborted", async () => {
    const ac = new AbortController();
    const d = deps({ signal: ac.signal, read: async (frames) => { ac.abort(); return read(frames); } });
    const r = await runTipoffDetection(7112, d);
    expect(r.outcome).toBe("cancelled");
  });

  it("reports progress stages in order", async () => {
    const stages: string[] = [];
    const d = deps({ onProgress: (p) => stages.push(p.stage) });
    await runTipoffDetection(7112, d);
    expect(stages.join(",")).toMatch(/^locate(,coarse)+(,fine)+$/);
  });
});
