/**
 * Scrubbing a timeline with a sideways swipe on a trackpad, or a mouse wheel
 * turned with Shift: which wheel events are that, and how far each one moves
 * the playhead. Ordinary scrolling is never taken for it.
 */

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
}

export const IDLE_WHEEL: WheelGesture = { axis: null, sumX: 0, sumY: 0, at: -Infinity };

/** Events further apart than this are two gestures. A trackpad's momentum sends them far closer together. */
export const WHEEL_GESTURE_GAP_MS = 140;
/** Movement (px) before a gesture's direction is read: fingers never land perfectly straight. */
const AXIS_PX = 4;
const LINE_PX = 16;
const PAGE_PX = 400;

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
    const px = dx !== 0 ? dx : dy;
    return { gesture: { axis: "x", sumX: 0, sumY: 0, at: now }, px: px === 0 ? null : px };
  }

  if (held.axis === "x") return { gesture: { ...held, at: now }, px: dx };
  if (held.axis === "y") return { gesture: { ...held, at: now }, px: null };

  const sumX = held.sumX + dx;
  const sumY = held.sumY + dy;
  if (Math.max(Math.abs(sumX), Math.abs(sumY)) < AXIS_PX) {
    return { gesture: { axis: null, sumX, sumY, at: now }, px: null };
  }
  if (Math.abs(sumX) > Math.abs(sumY)) return { gesture: { axis: "x", sumX: 0, sumY: 0, at: now }, px: sumX };
  return { gesture: { axis: "y", sumX: 0, sumY: 0, at: now }, px: null };
}
