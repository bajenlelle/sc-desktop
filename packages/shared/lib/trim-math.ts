/**
 * Trim handles: one clip's in and out points, dragged on a bar under the
 * player. Times are seconds into the game's video; a clip stores its trim as
 * per-clip offsets on top of the playlist's clip length (see clipBounds).
 * A trim may leave the logged play outside the clip: play-by-play times can
 * be off, and the coach puts the clip on the footage that shows the play.
 */

import { MIN_CLIP_SECONDS } from "./clip-timing";

/** The shortest a clip can be trimmed to. */
export { MIN_CLIP_SECONDS };

/** Seconds of footage the bar shows either side of the clip, room to drag a handle out. */
export const TRIM_MARGIN_SECONDS = 10;

const tenths = (n: number) => Math.round(n * 10) / 10;
const hundredths = (n: number) => Math.round(n * 100) / 100;

/** The video's end, when it is known. */
function videoEnd(duration: number | null): number {
  return duration !== null && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
}

/**
 * The stretch of footage the bar spans: the clip with `margin` either side,
 * inside the video. Never narrower than the clip itself, even when the
 * video's duration isn't known yet (or is shorter than the clip claims).
 */
export function trimRange({
  start,
  end,
  duration,
  margin = TRIM_MARGIN_SECONDS,
}: {
  start: number;
  end: number;
  duration: number | null;
  margin?: number;
}): { from: number; to: number } {
  const from = Math.max(0, start - margin);
  const to = Math.max(end, Math.min(videoEnd(duration), end + margin));
  return { from, to: to > from ? to : from + 1 };
}

export interface TrimLimits {
  start: number;
  end: number;
  /** The video's length, null while unknown. */
  duration: number | null;
  minLength?: number;
}

/**
 * Where a handle may go: anywhere in the video, the play included, as long
 * as the two ends stay at least `minLength` apart.
 */
export function trimEdgeLimits(
  edge: "in" | "out",
  { start, end, duration, minLength = MIN_CLIP_SECONDS }: TrimLimits,
): { min: number; max: number } {
  if (edge === "in") return { min: 0, max: Math.max(0, end - minLength) };
  const min = start + minLength;
  return { min, max: Math.max(min, videoEnd(duration)) };
}

/** A dragged handle's value: snapped to tenths of a second, then held inside its limits. */
export function clampTrimEdge(edge: "in" | "out", value: number, limits: TrimLimits): number {
  const { min, max } = trimEdgeLimits(edge, limits);
  return Math.min(max, Math.max(min, tenths(value)));
}

/**
 * The whole clip moved by `delta` seconds, its length unchanged: the start
 * snapped to tenths, then held inside the video.
 */
export function slideWindow(
  win: { start: number; end: number },
  delta: number,
  duration: number | null,
): { start: number; end: number } {
  const length = win.end - win.start;
  const latest = Math.max(0, videoEnd(duration) - length);
  const start = Math.min(latest, Math.max(0, tenths(win.start + delta)));
  return { start, end: start + length };
}

/**
 * The trim readout's words for where the play sits: "5 s before, 3.5 s
 * after" while the clip contains it, else how far the clip is from it.
 */
export function describeTrim({ eventTime, start, end }: { eventTime: number; start: number; end: number }): string {
  const before = tenths(eventTime - start);
  const after = tenths(end - eventTime);
  if (after < 0) return `ends ${formatSeconds(-after)} before the play`;
  if (before < 0) return `starts ${formatSeconds(-before)} after the play`;
  return `${formatSeconds(before)} before, ${formatSeconds(after)} after`;
}

/**
 * The per-clip offsets that store a trim: how far the in and out points sit
 * beyond the playlist's clip length. Rounded to hundredths, the precision of
 * the columns (numeric(5,2)).
 */
export function offsetsForTrim({
  eventTime,
  start,
  end,
  preRoll,
  postRoll,
}: {
  eventTime: number;
  start: number;
  end: number;
  preRoll: number;
  postRoll: number;
}): { preRollOffset: number; postRollOffset: number } {
  return {
    preRollOffset: hundredths(eventTime - start - preRoll) || 0,
    postRollOffset: hundredths(end - eventTime - postRoll) || 0,
  };
}

/** Seconds for a readout: "8.5 s", or "3 s" when there are no tenths; "−4 s" below zero. */
export function formatSeconds(n: number): string {
  const t = tenths(n) || 0;
  const abs = Math.abs(t);
  return `${t < 0 ? "\u2212" : ""}${Number.isInteger(abs) ? abs : abs.toFixed(1)} s`;
}

/**
 * A ± stepper over a value a trim made fractional lands on whole seconds
 * first: from 8.5, up is 9 and down is 8 (not 9.5 and 7.5). `next` is the
 * stepper's own proposal, which only says which way it went.
 */
export function stepToWhole(value: number, next: number): number {
  const EPS = 0.001;
  if (next > value) return Math.floor(value + EPS) + 1;
  if (next < value) return Math.ceil(value - EPS) - 1;
  return value;
}
