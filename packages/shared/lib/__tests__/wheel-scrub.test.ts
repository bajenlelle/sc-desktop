import { describe, expect, it } from "vitest";
import { IDLE_WHEEL, WHEEL_GESTURE_GAP_MS, swipeTime, wheelScrub, type SwipeScale, type WheelGesture, type WheelInput } from "../wheel-scrub";

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

  it("takes a notch of a mouse wheel turned with Shift as a small step, as Windows reports it", () => {
    // One notch arrives as 100 px: an eighth of a timeline, a jump and not a scrub.
    expect(feed([wheel(0, 100, { shiftKey: true })]).px).toEqual([16]);
  });

  it("takes a notch of a mouse wheel turned with Shift as a small step, as macOS reports it", () => {
    expect(feed([wheel(-100, 0, { shiftKey: true })]).px).toEqual([-16]);
  });

  it("leaves a trackpad swipe with Shift held at its own size", () => {
    expect(feed([wheel(5, 0, { shiftKey: true }), wheel(-3, 0, { shiftKey: true })]).px).toEqual([5, -3]);
  });

  it("reads a wheel that counts in lines", () => {
    expect(feed([wheel(3, 0, { deltaMode: 1 })]).px).toEqual([48]);
  });

  it("does nothing with an event that moved nothing", () => {
    expect(feed([wheel(0, 0)]).px).toEqual([null]);
  });
});

describe("swipeTime", () => {
  // A timeline zoomed on one quarter: 600 px for the video's seconds 600 to 1200, a second a pixel.
  const quarter: SwipeScale = {
    width: 600,
    xOf: (t) => Math.min(600, Math.max(0, t - 600)),
    tOf: (x) => 600 + Math.min(600, Math.max(0, x)),
  };
  const bounds = { min: 0, max: 7200 };

  it("moves the playhead a pixel for a pixel on the strip", () => {
    expect(swipeTime(700, 50, quarter, bounds)).toBe(750);
    expect(swipeTime(700, -50, quarter, bounds)).toBe(650);
  });

  it("stops at the strip's ends", () => {
    expect(swipeTime(1190, 50, quarter, bounds)).toBe(1200);
    expect(swipeTime(610, -50, quarter, bounds)).toBe(600);
  });

  it("follows a scale that folds a break into a few pixels", () => {
    // 100 px of play, a ten-minute break in 10 px, 100 px of play.
    const folded: SwipeScale = {
      width: 210,
      xOf: (t) => (t <= 100 ? t : t <= 700 ? 100 + (t - 100) / 60 : 110 + (t - 700)),
      tOf: (x) => (x <= 100 ? x : x <= 110 ? 100 + (x - 100) * 60 : 700 + (x - 110)),
    };
    expect(swipeTime(95, 10, folded, { min: 0, max: 800 })).toBe(400);
    expect(swipeTime(95, 20, folded, { min: 0, max: 800 })).toBe(705);
  });

  it("goes on from where the video is when the strip is zoomed on another quarter", () => {
    // In the fourth quarter with the strip on the second: forward is forward, not back to the second's last second.
    expect(swipeTime(2000, 30, quarter, bounds)).toBe(2030);
    expect(swipeTime(2000, -30, quarter, bounds)).toBe(1970);
    expect(swipeTime(100, -30, quarter, bounds)).toBe(70);
    expect(swipeTime(100, 30, quarter, bounds)).toBe(130);
  });

  it("comes onto the strip at the strip's own pace", () => {
    expect(swipeTime(1210, -30, quarter, bounds)).toBe(1180);
    expect(swipeTime(590, 30, quarter, bounds)).toBe(620);
  });

  it("never leaves the video", () => {
    expect(swipeTime(7190, 500, quarter, bounds)).toBe(7200);
    expect(swipeTime(20, -500, quarter, bounds)).toBe(0);
  });
});
