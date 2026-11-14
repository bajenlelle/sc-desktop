import { describe, expect, it } from "vitest";
import { IDLE_WHEEL, WHEEL_GESTURE_GAP_MS, wheelScrub, type WheelGesture, type WheelInput } from "../wheel-scrub";

const wheel = (deltaX: number, deltaY: number, more: Partial<WheelInput> = {}): WheelInput => ({ deltaX, deltaY, shiftKey: false, ...more });

/** Feeds events 16 ms apart, as a trackpad sends them, and returns what each one scrubbed. */
function feed(events: WheelInput[], from: WheelGesture = IDLE_WHEEL, start = 1_000): { px: (number | null)[]; gesture: WheelGesture } {
  let gesture = from;
  const px: (number | null)[] = [];
  events.forEach((e, i) => {
    const next = wheelScrub(gesture, e, start + i * 16);
    gesture = next.gesture;
    px.push(next.px);
  });
  return { px, gesture };
}

describe("wheelScrub", () => {
  it("scrubs with a sideways swipe, a pixel for a pixel", () => {
    expect(feed([wheel(6, 0), wheel(10, 1), wheel(-3, 0)]).px).toEqual([6, 10, -3]);
  });

  it("decides nothing on a first movement too small to tell sideways from up and down", () => {
    expect(feed([wheel(2, 1)]).px).toEqual([null]);
  });

  it("hands over what it held back once the swipe is clearly sideways", () => {
    expect(feed([wheel(2, 1), wheel(3, 0)]).px).toEqual([null, 5]);
  });

  it("leaves ordinary scrolling alone", () => {
    expect(feed([wheel(0, 12), wheel(1, 20), wheel(0, 8)]).px).toEqual([null, null, null]);
  });

  it("stays out of a scroll that drifts sideways on its way", () => {
    // Up and down first; the fingers then slide across. Still the same scroll.
    expect(feed([wheel(0, 12), wheel(9, 2), wheel(14, 0)]).px).toEqual([null, null, null]);
  });

  it("keeps scrubbing when a sideways swipe drifts up or down", () => {
    expect(feed([wheel(8, 0), wheel(2, 9), wheel(5, 1)]).px).toEqual([8, 2, 5]);
  });

  it("decides again after the fingers have rested", () => {
    const scroll = feed([wheel(0, 12), wheel(0, 9)]);
    const later = wheelScrub(scroll.gesture, wheel(7, 0), scroll.gesture.at + WHEEL_GESTURE_GAP_MS + 1);
    expect(later.px).toBe(7);
  });

  it("is still the same gesture while its momentum runs out", () => {
    const scroll = feed([wheel(0, 12), wheel(0, 9)]);
    const coasting = wheelScrub(scroll.gesture, wheel(7, 0), scroll.gesture.at + WHEEL_GESTURE_GAP_MS - 1);
    expect(coasting.px).toBeNull();
  });

  it("takes a mouse wheel turned with Shift, as Windows reports it", () => {
    expect(feed([wheel(0, 100, { shiftKey: true })]).px).toEqual([100]);
  });

  it("takes a mouse wheel turned with Shift, as macOS reports it", () => {
    expect(feed([wheel(-100, 0, { shiftKey: true })]).px).toEqual([-100]);
  });

  it("reads a wheel that counts in lines", () => {
    expect(feed([wheel(3, 0, { deltaMode: 1 })]).px).toEqual([48]);
  });

  it("does nothing with an event that moved nothing", () => {
    expect(feed([wheel(0, 0)]).px).toEqual([null]);
  });
});
