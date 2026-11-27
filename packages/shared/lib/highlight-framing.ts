/**
 * Framing a highlight clip for 9:16 from what Claude saw in it (the `highlight-frame` edge function).
 *
 * The desktop samples a clip's frames at 4 per second; Claude reports, per frame, where the player is (the
 * horizontal centre, 0..1 of the width), which frame shows the release of the scoring shot, and where the rim is.
 * This module turns that into the crop keyframes the export already draws (`crop-path.ts`): the window follows the
 * player up to the release, then eases to the rim, smoothed and kept inside the frame. It also suggests a tighter
 * start and end around the shot, and says when the result needs a look.
 *
 * Measured on 2026-11-27 (tracking-spike/claude_report.md): with Claude Opus 5.5 the player stayed in the window
 * 100% of the time on 9 broadcast clips. The smoothing below is the same as that test's (median of 5, Gaussian of
 * 0.15 s at 12 points a second, then the fewest keyframes within 1% of the width).
 *
 * Pure; the edge function call is highlight-frame-client.ts.
 */
import { clampCx, type CropKeyframe } from "./crop-path";

/** Frames per second the desktop samples for Claude. */
export const FRAME_SAMPLE_FPS = 4;
/** Width the frames are sent at. */
export const FRAME_SAMPLE_WIDTH = 960;
/** The most frames one call takes (a 10 s window at 4 fps fits). */
export const FRAME_MAX = 44;

export interface FrameObservation {
  /** Image number as sent, starting at 1. */
  image: number;
  /** The player's horizontal centre, 0..1 of the width; null when not visible. */
  x: number | null;
  cameraCut: boolean;
}

export interface ClipObservation {
  frames: FrameObservation[];
  /** Image where the ball leaves the player's hands on the scoring shot; null when there's none. */
  releaseImage: number | null;
  /** The rim's horizontal centre in the release image. */
  rimX: number | null;
  /** Image where the ball goes through. */
  madeImage: number | null;
  identity: "sure" | "likely" | "unsure";
  note: string;
}

/** Source-video times to sample between `start` and `end` (seconds), at most FRAME_MAX. */
export function sampleTimes(start: number, end: number, fps = FRAME_SAMPLE_FPS): number[] {
  const n = Math.min(FRAME_MAX, Math.floor((end - start) * fps + 1e-6) + 1);
  return Array.from({ length: Math.max(1, n) }, (_, i) => start + i / fps);
}

const EVAL_FPS = 12;
const PAN_S = 0.8;

/**
 * The crop keyframes for a clip: follow the player, then (for a shot) ease from the shooter to the rim over 0.8 s
 * after the release and hold there. `times` are the sampled frames' source times, in the order they were sent.
 * Gaps where the player wasn't seen are bridged; the ends hold. Always returns at least one keyframe.
 */
export function observationToKeyframes(
  times: number[],
  obs: ClipObservation,
  cropWFrac: number,
  shot: boolean,
): CropKeyframe[] {
  const n = times.length;
  const xs: (number | null)[] = Array(n).fill(null);
  for (const f of obs.frames) {
    const i = f.image - 1;
    if (i >= 0 && i < n && f.x != null && Number.isFinite(f.x)) xs[i] = Math.min(1, Math.max(0, f.x));
  }
  if (shot && obs.releaseImage != null && obs.rimX != null) {
    const iRel = Math.min(Math.max(obs.releaseImage - 1, 0), n - 1);
    const from = xs[iRel] ?? obs.rimX;
    for (let j = iRel + 1; j < n; j++) {
      let a = Math.min(1, (times[j] - times[iRel]) / PAN_S);
      a = a * a * (3 - 2 * a);
      xs[j] = from + (obs.rimX - from) * a;
    }
  }
  const known = xs.flatMap((x, i) => (x == null ? [] : [i]));
  if (known.length === 0) return [{ t: times[0] ?? 0, cx: 0.5 }];
  const filled = xs.map((_, i) => interp(i, known, known.map((k) => xs[k]!)));

  // resample to 12 a second, smooth, clamp, simplify
  const t0 = times[0];
  const t1 = times[n - 1];
  const tt: number[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / EVAL_FPS) tt.push(t);
  let x12 = tt.map((t) => interp(t, times, filled));
  x12 = medianFilter(x12, 5);
  x12 = gaussianFilter(x12, 0.15 * EVAL_FPS);
  x12 = x12.map((x) => clampCx(x, cropWFrac));
  return simplify(tt, x12, 0.01);
}

/** Linear interpolation of ys over xs (ascending) at x; holds the ends. */
function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  for (let i = 1; i <= last; i++) {
    if (x <= xs[i]) {
      const span = xs[i] - xs[i - 1];
      return span <= 0 ? ys[i] : ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / span;
    }
  }
  return ys[last];
}

/** Median over a window of `size`, edges repeated (scipy's mode="nearest"). */
export function medianFilter(xs: number[], size: number): number[] {
  const r = Math.floor(size / 2);
  return xs.map((_, i) => {
    const w: number[] = [];
    for (let k = i - r; k <= i + r; k++) w.push(xs[Math.min(xs.length - 1, Math.max(0, k))]);
    w.sort((a, b) => a - b);
    return w[r];
  });
}

/** Gaussian smoothing with `sigma` in samples, truncated at 4 sigma, edges repeated (scipy's gaussian_filter1d). */
export function gaussianFilter(xs: number[], sigma: number): number[] {
  const r = Math.floor(4 * sigma + 0.5);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const sum = k.reduce((a, b) => a + b, 0);
  return xs.map((_, i) => {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += k[j + r] * xs[Math.min(xs.length - 1, Math.max(0, i + j))];
    return acc / sum;
  });
}

/** The fewest keyframes that stay within `eps` of the curve (Ramer–Douglas–Peucker on one dimension). */
function simplify(ts: number[], xs: number[], eps: number): CropKeyframe[] {
  const keep = new Array(ts.length).fill(false);
  keep[0] = keep[ts.length - 1] = true;
  const stack: [number, number][] = [[0, ts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j <= i + 1) continue;
    let worst = -1;
    let at = -1;
    for (let k = i; k <= j; k++) {
      const chord = xs[i] + ((xs[j] - xs[i]) * (ts[k] - ts[i])) / Math.max(ts[j] - ts[i], 1e-9);
      const e = Math.abs(xs[k] - chord);
      if (e > worst) { worst = e; at = k; }
    }
    if (worst > eps) {
      keep[at] = true;
      stack.push([i, at], [at, j]);
    }
  }
  return ts.flatMap((t, i) => (keep[i] ? [{ t, cx: xs[i] }] : []));
}

/**
 * A tighter window around the shot: from 2.5 s before the release to 0.8 s after the ball goes through (or 1.3 s
 * after the release when Claude didn't see it go in), inside the sampled window. Null when there's no release.
 */
export function suggestedWindow(times: number[], obs: ClipObservation): { start: number; end: number } | null {
  if (obs.releaseImage == null) return null;
  const at = (img: number) => times[Math.min(Math.max(img - 1, 0), times.length - 1)];
  const release = at(obs.releaseImage);
  const made = obs.madeImage != null && obs.madeImage >= obs.releaseImage ? at(obs.madeImage) : release + 0.5;
  const start = Math.max(times[0], release - 2.5);
  const end = Math.min(times[times.length - 1], made + 0.8);
  return end - start >= 1.5 ? { start, end } : null;
}

/** True when the framing should get a look before the video is made: an unsure identity, or the player lost for long. */
export function needsCheck(obs: ClipObservation, frameCount: number): boolean {
  if (obs.identity === "unsure") return true;
  const seen = obs.frames.filter((f) => f.x != null).length;
  return frameCount > 0 && seen / frameCount < 0.7;
}
