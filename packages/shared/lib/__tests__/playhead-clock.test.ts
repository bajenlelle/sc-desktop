import { describe, expect, it } from "vitest";
import { PlayheadClock } from "../playhead-clock";

/** Runs the clock a frame at a time (16 ms) to `until` ms, feeding it the frames due by then; returns each position. */
function run(clock: PlayheadClock, until: number, frames: [number, number][] = [], from = 0, rate = 1): number[] {
  const out: number[] = [];
  let fi = 0;
  for (let ms = from; ms <= until; ms += 16) {
    while (fi < frames.length && frames[fi][0] <= ms) {
      clock.observe(frames[fi][1], frames[fi][0]);
      fi++;
    }
    out.push(clock.advance(ms, rate));
  }
  return out;
}

/** A start as measured in the app: no new frame for 350 ms, then frames from 20 ms in, at 25 fps. */
function lateStart(start: number): [number, number][] {
  const frames: [number, number][] = [];
  for (let i = 0; i < 60; i++) frames.push([350 + i * 40, start + 0.02 + i * 0.04]);
  return frames;
}

describe("PlayheadClock", () => {
  it("starts moving at once from where the clip starts", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    const positions = run(clock, 100);
    expect(positions[0]).toBe(10);
    expect(positions.at(-1)!).toBeGreaterThan(10.05);
  });

  it("never stops and never steps back while the picture starts late, and is level with it within a second", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    const frames = lateStart(10);
    const positions = run(clock, 2000, frames);
    for (let i = 1; i < positions.length; i++) expect(positions[i], `frame ${i}`).toBeGreaterThan(positions[i - 1]);
    const picture = (ms: number) => (ms < 350 ? 10 : 10.02 + (ms - 350) / 1000);
    const at = (ms: number) => positions[Math.round(ms / 16)];
    expect(at(320) - picture(320), "a little ahead while the picture holds").toBeLessThan(0.3);
    expect(Math.abs(at(1200) - picture(1200)), "level after a second").toBeLessThan(0.06);
  });

  it("keeps slow motion's pace", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    const frames: [number, number][] = [];
    for (let i = 0; i < 80; i++) frames.push([i * 40, 10 + i * 0.02]);
    const positions = run(clock, 2000, frames, 0, 0.5);
    expect(positions.at(-1)! - 10).toBeCloseTo(1, 1);
  });

  it("stops at a real stall once it is half a second ahead", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    const positions = run(clock, 4000, [[0, 10]]);
    // The picture is held at its frame (carried on at most 0.1 s), and the dot half a second past that.
    expect(positions.at(-1)!).toBeLessThanOrEqual(10.62);
    expect(positions.at(-1)).toBeCloseTo(positions.at(-20)!, 3);
  });

  it("catches up with a picture that runs ahead, faster than it plays", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    const frames: [number, number][] = [];
    for (let i = 0; i < 50; i++) frames.push([i * 40, 10.3 + i * 0.04]);
    const positions = run(clock, 1504, frames);
    expect(Math.abs(positions.at(-1)! - (10.3 + 1.504))).toBeLessThan(0.05);
  });

  it("jumps to a picture far ahead (a frame it couldn't catch up with in time)", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    run(clock, 32);
    clock.observe(12, 48);
    expect(clock.advance(48, 1)).toBeCloseTo(12, 3);
  });

  it("starts over at a reset", () => {
    const clock = new PlayheadClock();
    clock.reset(10, 0);
    run(clock, 500, lateStart(10));
    clock.reset(3, 600);
    expect(clock.advance(600, 1)).toBe(3);
  });
});
