/**
 * Automatic tip-off detection: find the second in a game recording where the
 * Q1 game clock starts running. Pure scheduling and interpretation; the frame
 * grabbing (ffmpeg sidecar) and the frame reading (Claude via the
 * `tipoff-detect` edge function) are injected through `DetectDeps`, so the
 * whole pipeline is testable with fakes and every network call stays small.
 *
 * Signal: a broadcast scoreboard shows the game clock stalled at 10:00 before
 * the jump ball and counting down after it. Warm-up countdowns also pass 10:00,
 * but at wall-clock rate and without a stall, so they are rejected. Recordings
 * that start after the tip-off (clock already below 10:00 in the first frames)
 * are reported as such with a negative offset estimate.
 */

export interface FrameReading {
  /** Position of the frame inside the request it was read in. */
  index: number;
  clockVisible: boolean;
  /** Game clock exactly as displayed ("10:00", "9:58", "0:45.3") or null. */
  clock: string | null;
  clockRunning: boolean | null;
  period: number | null;
  state: "pregame" | "lineup" | "in_play" | "stoppage" | "unknown";
  jumpBall: boolean | null;
}

export interface TimedReading extends FrameReading {
  /** Seconds into the recording. */
  t: number;
}

export interface Frame {
  t: number;
  jpegBase64: string;
  width: number;
  height: number;
}

/** Normalised 0..1 region of the frame holding the scoreboard graphic. */
export interface OverlayBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FrameView = "whole" | "overlay";

export const DETECT = {
  /** Dense samples at the start so "started after tip-off" is told apart from an early tip. */
  earlySamplesS: [0, 5, 10, 20],
  coarseStepS: 30,
  coarseWindowS: 1500,
  coarseExtendS: 900,
  coarseMaxS: 3300,
  fineFps: 1,
  finePadS: 2,
  periodLengthS: 600,
  maxFramesPerCall: 48,
  locateSamples: 3,
} as const;

/** Where Solidsport and baskettv productions draw the scoreboard: bottom band, centred. */
export const DEFAULT_OVERLAY_BOX: OverlayBox = { x: 0.2, y: 0.84, w: 0.6, h: 0.16 };

/** "9:58" → 598, "10:00" → 600, "0:45.3" → 45.3. Shot clocks ("24") and hour forms → null. */
export function parseClock(text: string | null | undefined): number | null {
  if (text == null) return null;
  const m = /^\s*(\d{1,2})[:.](\d{2})(?:[.,](\d))?\s*$/.exec(text);
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0);
  return Number.isFinite(s) ? s : null;
}

export function coarseSchedule(durationS: number, fromS = 0, toS: number = DETECT.coarseWindowS): number[] {
  const times = new Set<number>();
  if (fromS === 0) for (const t of DETECT.earlySamplesS) times.add(t);
  const first = fromS === 0 ? DETECT.coarseStepS : Math.ceil(fromS / DETECT.coarseStepS) * DETECT.coarseStepS;
  for (let t = first; t <= toS; t += DETECT.coarseStepS) times.add(t);
  return [...times].filter((t) => t < durationS - 1).sort((a, b) => a - b);
}

function clockOf(r: TimedReading): number | null {
  return r.clockVisible ? parseClock(r.clock) : null;
}

/** A pre-game countdown falls at wall-clock rate and reaches above 10:00; a game clock stalls at 10:00 first. */
export function isWarmupCountdown(readings: TimedReading[], periodLengthS: number = DETECT.periodLengthS): boolean {
  const pts = readings.map((r) => ({ t: r.t, c: clockOf(r) })).filter((p): p is { t: number; c: number } => p.c != null);
  if (pts.length < 3) return false;
  if (!pts.some((p) => p.c > periodLengthS + 0.5)) return false;
  let consistent = 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    const dc = pts[i - 1].c - pts[i].c;
    if (dt > 0 && Math.abs(dc - dt) <= Math.max(5, dt * 0.2)) consistent++;
  }
  return consistent >= Math.max(2, Math.floor((pts.length - 1) * 0.6));
}

export type CoarseVerdict =
  | { kind: "window"; startS: number; endS: number; basis: "clock" | "visual" }
  | { kind: "starts_after_tipoff"; firstClock: string | null; firstClockS: number | null; estimateS: number | null }
  | { kind: "extend"; fromS: number }
  | { kind: "not_found" };

/**
 * Decide from the coarse readings (any order) what to do next: run the fine pass
 * in a window, report a recording that starts after the tip-off, sample further,
 * or give up.
 */
export function interpretCoarse(
  readings: TimedReading[],
  durationS: number,
  opts: { periodLengthS?: number; sampledToS?: number } = {},
): CoarseVerdict {
  const periodLengthS = opts.periodLengthS ?? DETECT.periodLengthS;
  const sampledToS = opts.sampledToS ?? DETECT.coarseWindowS;
  const rs = [...readings].sort((a, b) => a.t - b.t);

  const first = rs.find((r) => r.t <= 5.5 && clockOf(r) != null);
  if (first) {
    const c = clockOf(first) as number;
    if (first.period != null && first.period >= 2) {
      return { kind: "starts_after_tipoff", firstClock: first.clock, firstClockS: c, estimateS: null };
    }
    if (c < periodLengthS - 0.5 && (first.period == null || first.period === 1)) {
      return { kind: "starts_after_tipoff", firstClock: first.clock, firstClockS: c, estimateS: first.t - (periodLengthS - c) };
    }
  }

  for (let k = 0; k < rs.length; k++) {
    const c = clockOf(rs[k]);
    if (c == null || c >= periodLengthS - 0.5 || c <= 0) continue;
    if (rs[k].period != null && rs[k].period !== 1) continue;
    const before = rs.slice(0, k);
    const stallSamples = before.filter((r) => {
      const b = clockOf(r);
      return b != null && Math.abs(b - periodLengthS) < 0.5;
    }).length;
    const quiet = before.length > 0 && before.every((r) => clockOf(r) == null || (clockOf(r) as number) >= periodLengthS - 0.5);
    if (stallSamples < 2 && isWarmupCountdown([...before, rs[k]], periodLengthS)) continue;
    if (!(stallSamples > 0 || quiet)) continue;
    const prevT = k > 0 ? rs[k - 1].t : 0;
    return { kind: "window", startS: Math.max(0, prevT - DETECT.finePadS), endS: rs[k].t + DETECT.finePadS, basis: "clock" };
  }

  if (!rs.some((r) => clockOf(r) != null)) {
    for (let k = 1; k < rs.length; k++) {
      const prev = rs[k - 1].state;
      const cur = rs[k].state;
      if ((prev === "pregame" || prev === "lineup") && (cur === "in_play" || cur === "stoppage")) {
        return { kind: "window", startS: Math.max(0, rs[k - 1].t - DETECT.finePadS), endS: rs[k].t + DETECT.finePadS, basis: "visual" };
      }
    }
  }

  if (sampledToS < DETECT.coarseMaxS && sampledToS < durationS - 1) return { kind: "extend", fromS: sampledToS };
  return { kind: "not_found" };
}

export function fineSchedule(w: { startS: number; endS: number }, fps: number = DETECT.fineFps): number[] {
  const out: number[] = [];
  for (let t = w.startS; t <= w.endS + 1e-9; t += 1 / fps) out.push(Number(t.toFixed(3)));
  return out;
}

export interface TipoffEstimate {
  seconds: number;
  confidence: number;
  basis: "clock_transition" | "first_running_clock" | "visual_play_start";
}

/** Fine readings (1 fps, any order) → the second the game clock started. */
export function estimateTipoff(
  fine: TimedReading[],
  opts: { periodLengthS?: number; basisHint?: "clock" | "visual" } = {},
): TipoffEstimate | null {
  const periodLengthS = opts.periodLengthS ?? DETECT.periodLengthS;
  const rs = [...fine].sort((a, b) => a.t - b.t);
  for (let k = 0; k < rs.length; k++) {
    const c = clockOf(rs[k]);
    if (c == null || c >= periodLengthS - 0.05 || c <= 0) continue;
    // The display truncates to whole seconds: the clock left 10:00 within the
    // second before this reading's elapsed time, so take the middle of it.
    const seconds = rs[k].t - (periodLengthS - c) - 0.5;
    let prevFull: number | null = null;
    for (let j = k - 1; j >= 0; j--) {
      const b = clockOf(rs[j]);
      if (b != null && Math.abs(b - periodLengthS) < 0.05) {
        prevFull = rs[j].t;
        break;
      }
    }
    const gap = prevFull == null ? Infinity : rs[k].t - prevFull;
    const confidence = gap <= 2.1 ? 0.92 : gap <= 5 ? 0.75 : 0.55;
    return { seconds: Number(seconds.toFixed(2)), confidence, basis: prevFull == null ? "first_running_clock" : "clock_transition" };
  }
  if (opts.basisHint === "visual") {
    for (let k = 1; k < rs.length; k++) {
      const prev = rs[k - 1].state;
      if ((prev === "pregame" || prev === "lineup") && rs[k].state === "in_play") {
        return { seconds: rs[k].t, confidence: 0.4, basis: "visual_play_start" };
      }
    }
  }
  return null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function padBox(b: OverlayBox, f = 0.5): OverlayBox {
  const x = Math.max(0, b.x - (b.w * f) / 2);
  const y = Math.max(0, b.y - (b.h * f) / 2);
  return { x, y, w: Math.min(1 - x, b.w * (1 + f)), h: Math.min(1 - y, b.h * (1 + f)) };
}

export interface DetectProgress {
  stage: "locate" | "coarse" | "fine";
  done: number;
  total: number;
}

export interface DetectDeps {
  /** Frames at the given seconds; `crop` present means the scoreboard region at reading resolution. */
  grab(times: number[], o: { view: FrameView; crop?: OverlayBox | null }): Promise<Frame[]>;
  /** One decode run at `fps` from `startS` for `durationS` seconds. */
  grabRange(startS: number, durationS: number, fps: number, o: { view: FrameView; crop?: OverlayBox | null }): Promise<Frame[]>;
  /** Reads every frame, same order and length. */
  read(frames: Frame[], view: FrameView): Promise<FrameReading[]>;
  /** Optional: ask where the scoreboard graphic is when the default region shows no clock. */
  locate?(frames: Frame[]): Promise<{ box: OverlayBox; confidence: number } | null>;
  onProgress?(p: DetectProgress): void;
  signal?: AbortSignal;
  log?(line: string): void;
}

export interface DetectStats {
  apiCalls: number;
  frames: number;
  elapsedMs: number;
}

export type DetectResult =
  | { outcome: "found"; estimate: TipoffEstimate; view: FrameView; stats: DetectStats; readings: TimedReading[]; fine: TimedReading[] }
  | { outcome: "starts_after_tipoff"; estimateS: number | null; firstClock: string | null; view: FrameView; stats: DetectStats; readings: TimedReading[] }
  | { outcome: "not_found"; view: FrameView; stats: DetectStats; readings: TimedReading[] }
  | { outcome: "cancelled"; stats: DetectStats };

export async function runTipoffDetection(
  durationS: number,
  deps: DetectDeps,
  opts: { strategy?: "crop" | "whole" } = {},
): Promise<DetectResult> {
  const t0 = Date.now();
  const stats: DetectStats = { apiCalls: 0, frames: 0, elapsedMs: 0 };
  const log = deps.log ?? (() => {});
  const aborted = () => deps.signal?.aborted === true;
  const finish = <R extends Omit<DetectResult, "stats">>(r: R) => ({ ...r, stats: { ...stats, elapsedMs: Date.now() - t0 } }) as R & { stats: DetectStats };

  async function readAll(frames: Frame[], view: FrameView): Promise<TimedReading[] | null> {
    const out: TimedReading[] = [];
    for (const part of chunk(frames, DETECT.maxFramesPerCall)) {
      if (aborted()) return null;
      const rd = await deps.read(part, view);
      stats.apiCalls++;
      stats.frames += part.length;
      if (rd.length !== part.length) throw new Error(`readings ${rd.length} != frames ${part.length}`);
      rd.forEach((r, i) => out.push({ ...r, t: part[i].t }));
    }
    return out;
  }

  // 1. Scoreboard crop: the default region first, then the model's box, else whole frames.
  let crop: OverlayBox | null = null;
  if (opts.strategy !== "whole") {
    const span = Math.min(DETECT.coarseWindowS, durationS);
    const probeTimes = [0.25, 0.5, 0.75].map((f) => Math.min(durationS - 1, f * span));
    deps.onProgress?.({ stage: "locate", done: 0, total: 1 });
    const crops = await deps.grab(probeTimes, { view: "overlay", crop: DEFAULT_OVERLAY_BOX });
    const rd = await readAll(crops, "overlay");
    if (rd == null) return finish({ outcome: "cancelled" as const });
    const visible = rd.filter((r) => r.clockVisible).length;
    log(`default region: clock visible in ${visible}/${rd.length}`);
    if (visible >= 1) crop = DEFAULT_OVERLAY_BOX;
    if (!crop && deps.locate) {
      const whole = await deps.grab(probeTimes, { view: "whole" });
      const loc = await deps.locate(whole);
      stats.apiCalls++;
      stats.frames += whole.length;
      if (loc?.box) {
        const padded = padBox(loc.box);
        const crops2 = await deps.grab(probeTimes, { view: "overlay", crop: padded });
        const rd2 = await readAll(crops2, "overlay");
        if (rd2 == null) return finish({ outcome: "cancelled" as const });
        const visible2 = rd2.filter((r) => r.clockVisible).length;
        log(`model region ${JSON.stringify(loc.box)}: clock visible in ${visible2}/${rd2.length}`);
        if (visible2 >= 1) crop = padded;
      }
    }
  }
  const view: FrameView = crop ? "overlay" : "whole";

  // 2. Coarse pass, extended while nothing has happened yet.
  let sampledTo = Math.min(DETECT.coarseWindowS, durationS);
  let fromS = 0;
  let readings: TimedReading[] = [];
  for (;;) {
    const times = coarseSchedule(durationS, fromS, sampledTo);
    deps.onProgress?.({ stage: "coarse", done: 0, total: times.length });
    const frames = await deps.grab(times, { view, crop });
    const rd = await readAll(frames, view);
    if (rd == null) return finish({ outcome: "cancelled" as const });
    readings = [...readings, ...rd];
    const verdict = interpretCoarse(readings, durationS, { sampledToS: sampledTo });
    log(`coarse ${times.length} frames → ${verdict.kind}`);
    if (verdict.kind === "extend") {
      fromS = sampledTo;
      sampledTo = Math.min(sampledTo + DETECT.coarseExtendS, durationS);
      continue;
    }
    if (verdict.kind === "not_found") return finish({ outcome: "not_found" as const, view, readings });
    if (verdict.kind === "starts_after_tipoff") {
      return finish({ outcome: "starts_after_tipoff" as const, estimateS: verdict.estimateS, firstClock: verdict.firstClock, view, readings });
    }

    // 3. Fine pass at 1 fps inside the window.
    const dur = verdict.endS - verdict.startS;
    deps.onProgress?.({ stage: "fine", done: 0, total: Math.ceil(dur * DETECT.fineFps) + 1 });
    const fineFrames = await deps.grabRange(verdict.startS, dur, DETECT.fineFps, { view, crop });
    const fine = await readAll(fineFrames, view);
    if (fine == null) return finish({ outcome: "cancelled" as const });
    const estimate = estimateTipoff(fine, { basisHint: verdict.basis });
    log(`fine ${fineFrames.length} frames → ${estimate ? `${estimate.seconds} s (${estimate.basis}, ${estimate.confidence})` : "nothing"}`);
    if (!estimate) return finish({ outcome: "not_found" as const, view, readings });
    return finish({ outcome: "found" as const, estimate, view, readings, fine });
  }
}
