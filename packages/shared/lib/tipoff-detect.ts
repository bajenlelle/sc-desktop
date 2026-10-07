/**
 * Automatic tip-off detection: find the second in a game recording where the
 * Q1 game clock starts running. Pure scheduling and interpretation; the frame
 * grabbing (ffmpeg sidecar) and the frame reading (Claude via the
 * `tipoff-detect` edge function) are injected through `DetectDeps`, so the
 * whole pipeline is testable with fakes and every network call stays small.
 *
 * Signals, in order of trust (all measured on real recordings, 2026-10-05):
 * 1. A broadcast scoreboard whose game clock stalls at 10:00 and then counts
 *    down — read from a crop of the scoreboard at native resolution. Pre-game
 *    countdowns also pass 10:00, so a drop only counts when no period-1 clock
 *    shows 10:00 again later. The graphic is a delayed data feed (0–8 s behind
 *    the picture, varying per game), and Scoutable syncs on wall clock, so a
 *    clock-based estimate is checked against the toss in whole frames and moved
 *    back to it when the court shows the ball up clearly earlier.
 * 2. Some productions draw a scoreboard whose clock never runs ("frozen"); the
 *    crop then says nothing and the pipeline re-samples whole frames and uses
 *    the state of play (lineup at the centre circle → live) and the jump ball.
 * 3. Recordings that start after the tip-off (clock already below 10:00 in the
 *    first frames, never back at 10:00) are reported with a negative estimate.
 * 4. The score (2026-10-06): overlays with no clock, or a clock stuck at 0 after
 *    the countdown, still show the points. The first scored sample caps the
 *    tip-off; whole frames every 5 s narrow the minutes before it to the jump
 *    ball, and the 1 fps pass runs there. In whole frames a clock estimate that
 *    contradicts its own window (an arena clock misread) is rejected.
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
  /** Point totals as the scoreboard graphic shows them (home first); null when none is readable, absent in readings from before 2026-10-06. */
  score?: { home: number; away: number } | null;
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
  /** A visual window longer than this is narrowed with whole frames every `narrowStepS` before the fine pass. */
  narrowMinSpanS: 45,
  narrowStepS: 5,
  /** The first basket can come minutes after the tip-off: how far a score-based window reaches back. */
  scoreLookbackS: 180,
  /** A jump-ball sample this close before the first live sample widens a window to include it. */
  jumpLookbackS: 90,
  /** Whole frames read around a clock-based estimate to check it against the toss. */
  courtLookbackS: 12,
  courtLookaheadS: 2,
  /** A toss this much before the clock estimate means the clock graphic ran late. */
  clockLagMinS: 2,
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

const isPeriodOne = (r: TimedReading) => r.period == null || r.period === 1;
const isLive = (st: TimedReading["state"]) => st === "in_play" || st === "stoppage";
const isPre = (st: TimedReading["state"]) => st === "pregame" || st === "lineup";

/** Points on the board, or null when the reading carries no score. */
const scoreOf = (r: TimedReading): number | null => (r.score ? r.score.home + r.score.away : null);
const hasPoints = (r: TimedReading) => (scoreOf(r) ?? 0) > 0;
const isNilNil = (r: TimedReading) => scoreOf(r) === 0;

/**
 * Where a window ending at sample k should start when whole frames are being read:
 * the previous sample, or earlier when a pre-game state or a jump-ball flag sits just before.
 */
function visualStartBefore(rs: TimedReading[], k: number): number {
  const prevT = k > 0 ? rs[k - 1].t : 0;
  const lastPre = [...rs.slice(Math.max(0, k - 3), k)].reverse().find((r) => isPre(r.state));
  const firstJump = rs.slice(0, k).find((r) => r.jumpBall === true && r.t >= rs[k].t - DETECT.jumpLookbackS);
  return Math.min(prevT, lastPre?.t ?? prevT, firstJump?.t ?? prevT);
}

/**
 * Index of the first sample with points on the board that the next sample confirms,
 * after a 0-0 reading; "starts_after" when the recording opens with points and
 * never shows 0-0; null when the readings carry no usable score.
 */
function firstScoredSample(rs: TimedReading[]): number | "starts_after" | null {
  if (!rs.some((r) => scoreOf(r) != null)) return null;
  if (!rs.some(isNilNil)) return rs.length >= 2 && rs[0].t <= 5.5 && hasPoints(rs[0]) && hasPoints(rs[1]) ? "starts_after" : null;
  for (let k = 0; k < rs.length - 1; k++) {
    if (!hasPoints(rs[k]) || !hasPoints(rs[k + 1])) continue;
    if (!rs.slice(0, k).some(isNilNil)) continue;
    return k;
  }
  return null;
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
  /** The scoreboard crop has no usable clock (stuck at 10:00, or none readable): sample whole frames instead. */
  | { kind: "frozen_clock" }
  | { kind: "extend"; fromS: number }
  | { kind: "not_found" };

export interface InterpretOptions {
  periodLengthS?: number;
  sampledToS?: number;
  /** Which frames produced the readings; a frozen clock only triggers the whole-frame fallback from a crop. */
  view?: FrameView;
  /** Ignore the clock and use the state of play only. */
  visualOnly?: boolean;
}

/**
 * Decide from the coarse readings (any order) what to do next: run the fine pass
 * in a window, report a recording that starts after the tip-off, re-sample whole
 * frames, sample further, or give up.
 */
/**
 * Some productions run a pre-game countdown ("Starting 05:54") in the clock field
 * with no period label, and the overlay only switches to period 1 at the tip. Such
 * a countdown can sit below 10:00 from the first frame, so it reads like a game
 * clock that is already running. When the first three or more clock readings have
 * no period and a period-1 reading follows, their clocks are dropped: what remains
 * is then judged by the game clock (Alvik–Eskilstuna), the state of play (Alvik–AIK)
 * or the frozen-clock rule (Huddinge–Fryshuset), as the 2026-10-06 spike showed.
 */
function withoutPregameCountdown(rs: TimedReading[]): TimedReading[] {
  const flip = rs.findIndex((r) => r.period === 1);
  if (flip < 0) return rs;
  const lead = rs.slice(0, flip);
  if (lead.some((r) => r.period != null)) return rs;
  if (lead.filter((r) => clockOf(r) != null).length < 3) return rs;
  // The label can flip to "1st" before the countdown ends (EOS–Ockelbo): keep
  // dropping readings that continue it at wall-clock rate, stop at the first that doesn't.
  let end = flip;
  let prev = [...lead].reverse().find((r) => clockOf(r) != null) as TimedReading;
  while (end < rs.length) {
    const r = rs[end];
    const c = clockOf(r);
    if (c == null || !isPeriodOne(r)) break;
    const dt = r.t - prev.t;
    if (dt <= 0 || Math.abs((clockOf(prev) as number) - c - dt) > Math.max(3, dt * 0.1)) break;
    prev = r;
    end++;
  }
  return rs.map((r, i) => (i < end ? { ...r, clockVisible: false, clock: null } : r));
}

/**
 * A quiet start (no 10:00 seen) only locates the tip-off if the first running
 * clock is close to 10:00; one that is minutes in says nothing about when the
 * period began, and guessing put a tip-off before the recording started.
 */
const QUIET_START_MAX_ELAPSED_S = 90;

export function interpretCoarse(readings: TimedReading[], durationS: number, opts: InterpretOptions = {}): CoarseVerdict {
  const periodLengthS = opts.periodLengthS ?? DETECT.periodLengthS;
  const sampledToS = opts.sampledToS ?? DETECT.coarseWindowS;
  const rs = withoutPregameCountdown([...readings].sort((a, b) => a.t - b.t));
  const atFull = (r: TimedReading) => {
    const c = clockOf(r);
    return c != null && Math.abs(c - periodLengthS) < 0.5;
  };

  if (!opts.visualOnly) {
    // Clock already running at the very start — unless a period-1 clock shows 10:00
    // again later, which makes the early readings a pre-game countdown.
    const first = rs.find((r) => r.t <= 5.5 && clockOf(r) != null);
    const laterFull = rs.some((r) => r.t > 5.5 && isPeriodOne(r) && atFull(r));
    if (first && !laterFull) {
      const c = clockOf(first) as number;
      if (first.period != null && first.period >= 2) {
        return { kind: "starts_after_tipoff", firstClock: first.clock, firstClockS: c, estimateS: null };
      }
      if (c < periodLengthS - 0.5 && isPeriodOne(first)) {
        return { kind: "starts_after_tipoff", firstClock: first.clock, firstClockS: c, estimateS: first.t - (periodLengthS - c) };
      }
    }

    // First sample where the period-1 clock has left 10:00 after a stall or a quiet start.
    for (let k = 0; k < rs.length; k++) {
      const c = clockOf(rs[k]);
      if (c == null || c >= periodLengthS - 0.5 || c <= 0) continue;
      if (!isPeriodOne(rs[k])) continue;
      const before = rs.slice(0, k);
      const stallSamples = before.filter(atFull).length;
      const quiet = before.length > 0 && before.every((r) => clockOf(r) == null || (clockOf(r) as number) >= periodLengthS - 0.5);
      const resetLater = rs.slice(k + 1).some((r) => isPeriodOne(r) && atFull(r));
      if (resetLater) continue;
      if (stallSamples < 2 && isWarmupCountdown([...before, rs[k]], periodLengthS)) continue;
      if (!(stallSamples > 0 || quiet)) continue;
      if (stallSamples === 0 && c < periodLengthS - QUIET_START_MAX_ELAPSED_S) continue;
      // Whole frames also show the court: let the window cover a jump ball or lineup seen just before.
      const startAt = opts.view === "whole" ? visualStartBefore(rs, k) : k > 0 ? rs[k - 1].t : 0;
      return { kind: "window", startS: Math.max(0, startAt - DETECT.finePadS), endS: rs[k].t + DETECT.finePadS, basis: "clock" };
    }
  }

  // The score is the one thing every production shows, clock or not. A recording
  // whose first frames already carry points started after the tip-off; otherwise
  // the first sample with points (confirmed by the next) caps the tip-off from
  // above, and the fine pass looks for the jump ball in the minutes before it.
  const scoredAt = firstScoredSample(rs);
  if (scoredAt === "starts_after") return { kind: "starts_after_tipoff", firstClock: null, firstClockS: null, estimateS: null };
  const scoreWindow = (): CoarseVerdict | null =>
    scoredAt == null ? null : { kind: "window", startS: Math.max(0, rs[scoredAt].t - DETECT.scoreLookbackS), endS: rs[scoredAt].t + DETECT.finePadS, basis: "visual" };

  // A clock that never leaves 10:00 across the samples is a static graphic.
  const clocks = rs.filter((r) => clockOf(r) != null);
  const frozen = clocks.length >= Math.max(3, rs.length * 0.6) && clocks.every(atFull);
  // A scoreboard crop whose score moves says when the game was under way even if
  // its clock is frozen, dead or missing; the court is sampled from there.
  if (opts.view === "overlay" && !opts.visualOnly) {
    const w = scoreWindow();
    if (w) return w;
  }
  if (frozen && !opts.visualOnly && opts.view !== "whole") return { kind: "frozen_clock" };
  // A scoreboard crop with no readable clock at all can't show the play either
  // (its states are guesses), so the court has to be looked at instead.
  if (clocks.length === 0 && opts.view === "overlay" && !opts.visualOnly) return { kind: "frozen_clock" };

  // No usable clock, or whole frames whose clock said nothing: sustained play
  // after a pregame/lineup sample.
  if (clocks.length === 0 || frozen || opts.visualOnly || opts.view === "whole") {
    for (let k = 1; k < rs.length; k++) {
      if (!isLive(rs[k].state)) continue;
      const next = rs[k + 1];
      const after = rs[k + 2];
      const sustained = next == null || isLive(next.state) || (after != null && isLive(after.state));
      const before = rs.slice(Math.max(0, k - 3), k);
      const lastPre = [...before].reverse().find((r) => isPre(r.state));
      if (sustained && lastPre) {
        return { kind: "window", startS: Math.max(0, visualStartBefore(rs, k) - DETECT.finePadS), endS: rs[k].t + DETECT.finePadS, basis: "visual" };
      }
    }
  }
  if (opts.view !== "overlay") {
    const w = scoreWindow();
    if (w) return w;
  }

  if (sampledToS < DETECT.coarseMaxS && sampledToS < durationS - 1) return { kind: "extend", fromS: sampledToS };
  return { kind: "not_found" };
}

/**
 * Shrink a long visual window using whole frames read every few seconds: it ends
 * at the first sample of sustained play and starts at the first jump-ball flag
 * shortly before it, else at the last pre-game sample, else 45 s earlier.
 */
export function narrowVisualWindow(readings: TimedReading[], w: { startS: number; endS: number }): { startS: number; endS: number } {
  const rs = [...readings].sort((a, b) => a.t - b.t);
  const pad = DETECT.finePadS;
  const span = DETECT.narrowMinSpanS;
  const k = rs.findIndex((r, i) => isLive(r.state) && (i + 1 >= rs.length || isLive(rs[i + 1].state)));
  if (k < 0) return { startS: Math.max(w.startS, w.endS - span), endS: w.endS };
  const live = rs[k];
  const firstJump = rs.slice(0, k + 1).find((r) => r.jumpBall === true && r.t >= live.t - 60);
  const lastPre = [...rs.slice(0, k)].reverse().find((r) => isPre(r.state));
  const startAt = firstJump ? firstJump.t - pad : lastPre ? lastPre.t - pad : live.t - span;
  return { startS: Math.max(w.startS, 0, startAt), endS: Math.min(w.endS, live.t + pad) };
}

export function narrowSchedule(w: { startS: number; endS: number }, stepS: number = DETECT.narrowStepS): number[] {
  const out: number[] = [];
  for (let t = w.startS; t <= w.endS + 1e-9; t += stepS) out.push(Number(t.toFixed(3)));
  return out;
}

export function fineSchedule(w: { startS: number; endS: number }, fps: number = DETECT.fineFps): number[] {
  const out: number[] = [];
  for (let t = w.startS; t <= w.endS + 1e-9; t += 1 / fps) out.push(Number(t.toFixed(3)));
  return out;
}

export interface TipoffEstimate {
  seconds: number;
  confidence: number;
  basis: "clock_transition" | "first_running_clock" | "visual_jump_ball" | "visual_play_start";
}

/** Fine readings (1 fps, any order) → the second the game clock started. */
export function estimateTipoff(
  fine: TimedReading[],
  opts: { periodLengthS?: number; basisHint?: "clock" | "visual"; window?: { startS: number; endS: number }; view?: FrameView } = {},
): TipoffEstimate | null {
  const periodLengthS = opts.periodLengthS ?? DETECT.periodLengthS;
  const rs = [...fine].sort((a, b) => a.t - b.t);
  const whole = opts.view === "whole";
  const visualHint = opts.basisHint === "visual";

  let clock: TipoffEstimate | null = null;
  for (let k = 0; k < rs.length && !clock; k++) {
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
    clock = { seconds: Number(seconds.toFixed(2)), confidence, basis: prevFull == null ? "first_running_clock" : "clock_transition" };
  }
  // The window was opened because the clock left 10:00 inside it; a clock estimate
  // far outside contradicts that and is a misread (in whole frames, the arena clock).
  const fits = clock && (!opts.window || (clock.seconds >= opts.window.startS - 5 && clock.seconds <= opts.window.endS + 1)) ? clock : null;
  if (fits && (fits.basis === "clock_transition" || (!whole && !visualHint))) return fits;

  // Whole frames show the court: the jump ball, else the first live frame after a pre-game one.
  if (whole || visualHint) {
    const jumps = rs.filter((r) => r.jumpBall === true);
    if (jumps.length > 0) {
      return { seconds: Number((jumps[jumps.length - 1].t + 0.5).toFixed(2)), confidence: 0.6, basis: "visual_jump_ball" };
    }
    for (let k = 1; k < rs.length; k++) {
      if (isPre(rs[k - 1].state) && rs[k].state === "in_play") {
        return { seconds: rs[k].t, confidence: 0.4, basis: "visual_play_start" };
      }
    }
  }
  return visualHint ? null : fits;
}

/**
 * The scoreboard graphic is a delayed data feed: it can leave 10:00 seconds after
 * the ball went up, and the sync point must sit at the toss (Scoutable syncs on
 * wall clock). Given whole-frame readings around a clock-based estimate, move it
 * to the last jump-ball frame when that is clearly earlier; keep it otherwise.
 */
export function reconcileWithJumpBall(estimate: TipoffEstimate, court: TimedReading[]): TipoffEstimate {
  if (estimate.basis !== "clock_transition" && estimate.basis !== "first_running_clock") return estimate;
  // The clock cannot start before the toss: a flag after it is a misread.
  const jumps = court.filter((r) => r.jumpBall === true && r.t <= estimate.seconds + 1).sort((a, b) => a.t - b.t);
  if (jumps.length === 0) return estimate;
  const toss = Number((jumps[jumps.length - 1].t + 0.5).toFixed(2));
  if (estimate.seconds - toss < DETECT.clockLagMinS) return estimate;
  return { seconds: toss, confidence: 0.7, basis: "visual_jump_ball" };
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
  stage: "locate" | "coarse" | "narrow" | "fine";
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
  | { outcome: "found"; estimate: TipoffEstimate; view: FrameView; stats: DetectStats; readings: TimedReading[]; narrow?: TimedReading[]; fine: TimedReading[]; court?: TimedReading[] }
  | { outcome: "starts_after_tipoff"; estimateS: number | null; firstClock: string | null; view: FrameView; stats: DetectStats; readings: TimedReading[] }
  | { outcome: "not_found"; view: FrameView; stats: DetectStats; readings: TimedReading[]; narrow?: TimedReading[]; fine?: TimedReading[] }
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
    // A crop is worth reading if it shows a clock, or a score (overlays without a clock exist).
    const usable = (rs: FrameReading[]) => ({ clock: rs.filter((r) => r.clockVisible).length, score: rs.filter((r) => r.score != null).length });
    const u = usable(rd);
    log(`default region: clock visible in ${u.clock}/${rd.length}, score in ${u.score}/${rd.length}`);
    if (u.clock >= 1 || u.score >= 2) crop = DEFAULT_OVERLAY_BOX;
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
        const u2 = usable(rd2);
        log(`model region ${JSON.stringify(loc.box)}: clock visible in ${u2.clock}/${rd2.length}, score in ${u2.score}/${rd2.length}`);
        if (u2.clock >= 1 || u2.score >= 2) crop = padded;
      }
    }
  }
  let view: FrameView = crop ? "overlay" : "whole";

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
    let verdict = interpretCoarse(readings, durationS, { sampledToS: sampledTo, view });
    log(`coarse ${times.length} frames → ${verdict.kind}`);
    if (verdict.kind === "frozen_clock") {
      // The crop's clock is frozen or unreadable; look at the court instead for every sample so far.
      const allTimes = readings.map((r) => r.t);
      const whole = await deps.grab(allTimes, { view: "whole" });
      const wrd = await readAll(whole, "whole");
      if (wrd == null) return finish({ outcome: "cancelled" as const });
      readings = wrd;
      view = "whole";
      crop = null;
      verdict = interpretCoarse(readings, durationS, { sampledToS: sampledTo, view, visualOnly: true });
      log(`no usable clock in the crop → whole frames ${whole.length} → ${verdict.kind}`);
    }
    if (verdict.kind === "extend") {
      fromS = sampledTo;
      sampledTo = Math.min(sampledTo + DETECT.coarseExtendS, durationS);
      continue;
    }
    if (verdict.kind === "not_found" || verdict.kind === "frozen_clock") return finish({ outcome: "not_found" as const, view, readings });
    if (verdict.kind === "starts_after_tipoff") {
      return finish({ outcome: "starts_after_tipoff" as const, estimateS: verdict.estimateS, firstClock: verdict.firstClock, view, readings });
    }

    // 3. A visual window needs the court, not the graphic; a long one is narrowed first.
    let win = { startS: verdict.startS, endS: verdict.endS };
    let narrow: TimedReading[] | undefined;
    if (verdict.basis === "visual") {
      view = "whole";
      crop = null;
      if (win.endS - win.startS > DETECT.narrowMinSpanS) {
        const times = narrowSchedule(win);
        deps.onProgress?.({ stage: "narrow", done: 0, total: times.length });
        const frames = await deps.grab(times, { view: "whole" });
        const rd = await readAll(frames, "whole");
        if (rd == null) return finish({ outcome: "cancelled" as const });
        narrow = rd;
        win = narrowVisualWindow(rd, win);
        log(`narrow ${times.length} frames → ${win.startS}–${win.endS} s`);
      }
    }

    // 4. Fine pass at 1 fps inside the window.
    const dur = win.endS - win.startS;
    deps.onProgress?.({ stage: "fine", done: 0, total: Math.ceil(dur * DETECT.fineFps) + 1 });
    const fineFrames = await deps.grabRange(win.startS, dur, DETECT.fineFps, { view, crop });
    const fine = await readAll(fineFrames, view);
    if (fine == null) return finish({ outcome: "cancelled" as const });
    let estimate = estimateTipoff(fine, { basisHint: verdict.basis, window: win, view });
    log(`fine ${fineFrames.length} frames → ${estimate ? `${estimate.seconds} s (${estimate.basis}, ${estimate.confidence})` : "nothing"}`);
    if (!estimate) return finish({ outcome: "not_found" as const, view, readings, narrow, fine });

    // 5. The clock graphic can run late: check a clock-based estimate against the toss on court.
    let court: TimedReading[] | undefined;
    if (estimate.basis === "clock_transition" || estimate.basis === "first_running_clock") {
      const from = Math.max(0, estimate.seconds - DETECT.courtLookbackS);
      const courtFrames = await deps.grabRange(from, estimate.seconds + DETECT.courtLookaheadS - from, DETECT.fineFps, { view: "whole" });
      const rd = await readAll(courtFrames, "whole");
      if (rd == null) return finish({ outcome: "cancelled" as const });
      court = rd;
      const checked = reconcileWithJumpBall(estimate, rd);
      log(
        checked === estimate
          ? `court ${courtFrames.length} frames → agrees`
          : `court ${courtFrames.length} frames → toss at ${checked.seconds} s, clock graphic ${(estimate.seconds - checked.seconds).toFixed(1)} s late`,
      );
      estimate = checked;
    }
    return finish({ outcome: "found" as const, estimate, view, readings, narrow, fine, court });
  }
}
