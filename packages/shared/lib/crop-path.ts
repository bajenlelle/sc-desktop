/**
 * Crop-path math for vertical (9:16) export — the single source of truth
 * for both the editor's live preview and the ffmpeg export, so what the
 * user scrubs is exactly what renders.
 *
 * Model: a clip's pan is a sparse list of keyframes { t, cx } where t is
 * ABSOLUTE source-video seconds (robust to pre/post-roll edits) and cx is
 * the crop-window CENTER normalized to 0..1 of source width (resolution
 * independent). Between keyframes the window moves with linear
 * interpolation; outside the keyframed range it holds the nearest value —
 * the sparse-keyframes-plus-interpolation architecture every reframing
 * tool (Premiere Auto Reframe, DaVinci, CapCut, AutoFlip) converges on.
 */

export interface CropKeyframe {
  /** Absolute source-video time, seconds. */
  t: number;
  /** Crop-window center, normalized 0..1 of source width. */
  cx: number;
}

/** Center fallback when a clip has no keyframes: static middle crop. */
export const DEFAULT_CX = 0.5;

/** 9:16 window width as a fraction of a 16:9 source's width: (h*9/16)/w. */
export function cropWidthFrac(sourceW: number, sourceH: number): number {
  return Math.min(1, (sourceH * 9) / 16 / sourceW);
}

function sorted(keyframes: CropKeyframe[]): CropKeyframe[] {
  return [...keyframes].sort((a, b) => a.t - b.t);
}

/**
 * Window center at time t: linear interpolation between surrounding
 * keyframes, clamped to the first/last value outside the range.
 * Empty/missing keyframes → DEFAULT_CX.
 */
export function cxAt(keyframes: CropKeyframe[] | undefined, t: number): number {
  if (!keyframes || keyframes.length === 0) return DEFAULT_CX;
  const kfs = sorted(keyframes);
  if (t <= kfs[0].t) return kfs[0].cx;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.cx;
  for (let i = 1; i < kfs.length; i++) {
    if (t <= kfs[i].t) {
      const a = kfs[i - 1];
      const b = kfs[i];
      const span = b.t - a.t;
      if (span <= 0) return b.cx;
      return a.cx + ((b.cx - a.cx) * (t - a.t)) / span;
    }
  }
  return last.cx;
}

/** Keep the window inside the frame: center is limited by half its width. */
export function clampCx(cx: number, cropWFrac: number): number {
  const half = cropWFrac / 2;
  if (half >= 0.5) return 0.5;
  return Math.min(1 - half, Math.max(half, cx));
}

/**
 * Convert absolute-time keyframes to a segment-relative list for export:
 * t' = t - clipStart, keyframes outside [clipStart, clipEnd] collapse onto
 * the boundary (preserving the interpolated value there), sorted, deduped
 * (last write wins within 1 ms), always non-empty. ffmpeg's crop filter
 * sees t starting at 0 from the seek point, so segment-relative is the
 * wire format.
 */
export function toSegmentKeyframes(
  keyframes: CropKeyframe[] | undefined,
  clipStart: number,
  clipEnd: number,
): CropKeyframe[] {
  if (!keyframes || keyframes.length === 0) return [{ t: 0, cx: DEFAULT_CX }];
  const duration = Math.max(0, clipEnd - clipStart);
  // Sample the interpolated path at the boundaries so out-of-range
  // keyframes still shape the pan correctly inside the window.
  const inside = sorted(keyframes).filter((k) => k.t > clipStart && k.t < clipEnd);
  const result: CropKeyframe[] = [
    { t: 0, cx: cxAt(keyframes, clipStart) },
    ...inside.map((k) => ({ t: k.t - clipStart, cx: k.cx })),
    { t: duration, cx: cxAt(keyframes, clipEnd) },
  ];
  const deduped: CropKeyframe[] = [];
  for (const k of result) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.t - k.t) < 0.001) {
      deduped[deduped.length - 1] = k;
    } else {
      deduped.push(k);
    }
  }
  return deduped;
}
