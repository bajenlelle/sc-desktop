/**
 * Scrubbing a timeline with a sideways swipe on a trackpad, or a mouse wheel
 * turned with Shift: which wheel events are that, how far each one moves the
 * playhead, and where that takes the video. Ordinary scrolling is never taken
 * for it.
 */
import { clamp } from "./motion-math";

/** A wheel event's numbers, as the browser reports them. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  /** 0 pixels (the default), 1 lines, 2 pages. */
  deltaMode?: number;
}

/** One swipe or scroll, from its first event until the fingers have rested. */
export interface WheelGesture {
  /** Which way the gesture goes, once that is clear: "x" scrubs, "y" is a scroll and is left alone. */
  axis: "x" | "y" | null;
  /** What has moved while the axis was still open; handed over when it turns out sideways. */
  sumX: number;
  sumY: number;
  /** When its latest event came (ms). */
  at: number;
  /** A mouse's sideways wheel (tilt or thumb wheel), not a trackpad: each event moves at most a notch's step. */
  notched?: boolean;
}

export const IDLE_WHEEL: WheelGesture = { axis: null, sumX: 0, sumY: 0, at: -Infinity };

/** Events further apart than this are two gestures. A trackpad's momentum sends them far closer together. */
export const WHEEL_GESTURE_GAP_MS = 140;
/** Movement (px) before a gesture's direction is read: fingers never land perfectly straight. */
const AXIS_PX = 4;
const LINE_PX = 16;
const PAGE_PX = 400;
/**
 * The most one event of a wheel turned with Shift moves the playhead. A notch
 * of a mouse wheel arrives as 100 px or so, an eighth of a timeline: a jump,
 * not a scrub. A trackpad's events are far smaller and pass untouched.
 */
const NOTCH_PX = 16;
/**
 * A gesture whose first event already moves this far sideways is a mouse's
 * sideways wheel (a tilt or thumb wheel: about 100 px a notch, with no Shift):
 * a trackpad swipe starts with the fingers' small first movements.
 */
const NOTCH_START_PX = 50;

/**
 * Takes one wheel event. `px` is how far it moves the playhead (positive is
 * later), or null when the event isn't a scrub: a scroll up or down, or a
 * movement too small to tell yet. A gesture keeps the direction it started
 * in, so a scroll that drifts sideways never scrubs and a swipe that drifts
 * up or down keeps scrubbing.
 */
export function wheelScrub(prev: WheelGesture, e: WheelInput, now: number): { gesture: WheelGesture; px: number | null } {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  const fresh = now - prev.at > WHEEL_GESTURE_GAP_MS;
  const held = fresh ? IDLE_WHEEL : prev;

  // A wheel turned with Shift is sideways by intent. macOS reports it as deltaX, Windows as deltaY with the key.
  if (e.shiftKey) {
    const px = clamp(dx !== 0 ? dx : dy, -NOTCH_PX, NOTCH_PX);
    return { gesture: { axis: "x", sumX: 0, sumY: 0, at: now }, px: px === 0 ? null : px };
  }

  if (held.axis === "x") return { gesture: { ...held, at: now }, px: held.notched ? clamp(dx, -NOTCH_PX, NOTCH_PX) : dx };
  if (held.axis === "y") return { gesture: { ...held, at: now }, px: null };

  if (held.axis === null && held.sumX === 0 && held.sumY === 0 && Math.abs(dx) >= NOTCH_START_PX && Math.abs(dy) < AXIS_PX) {
    return { gesture: { axis: "x", sumX: 0, sumY: 0, at: now, notched: true }, px: clamp(dx, -NOTCH_PX, NOTCH_PX) };
  }

  const sumX = held.sumX + dx;
  const sumY = held.sumY + dy;
  if (Math.max(Math.abs(sumX), Math.abs(sumY)) < AXIS_PX) {
    return { gesture: { axis: null, sumX, sumY, at: now }, px: null };
  }
  if (Math.abs(sumX) > Math.abs(sumY)) return { gesture: { axis: "x", sumX: 0, sumY: 0, at: now }, px: sumX };
  return { gesture: { axis: "y", sumX: 0, sumY: 0, at: now }, px: null };
}

/** As much of a timeline's scale as a swipe needs: its width (px) and the way between pixels and the video's seconds. */
export interface SwipeScale {
  width: number;
  xOf: (t: number) => number;
  tOf: (x: number) => number;
}

/**
 * Where a swipe of `px` takes a video that is at second `t`. On the strip the
 * playhead moves a pixel for a pixel and stops at the strip's ends, as a drag
 * does. Off it (the strip is zoomed on a quarter the video isn't in) there is
 * no playhead to move: the video goes on from where it is, at the strip's own
 * pace, so a swipe forward is forward and never a jump back to the zoomed
 * quarter. `bounds` are the video's own first and last second.
 */
export function swipeTime(t: number, px: number, scale: SwipeScale, bounds: { min: number; max: number }): number {
  const first = scale.tOf(0);
  const last = scale.tOf(scale.width);
  if (t >= first && t <= last) return scale.tOf(clamp(scale.xOf(t) + px, 0, scale.width));
  const pace = scale.width > 0 ? (last - first) / scale.width : 0;
  return clamp(t + px * pace, bounds.min, bounds.max);
}
