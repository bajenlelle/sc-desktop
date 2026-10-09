import { describe, expect, it } from "vitest";
import { clamp, project, rubberband, velocityFromSamples } from "../motion-math";

describe("project", () => {
  it("projects further the faster the flick", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(2000)).toBeCloseTo(998, 0);
  });

  it("keeps the sign of the velocity", () => {
    expect(project(-1000)).toBeCloseTo(-499, 0);
  });

  it("travels less with a snappier deceleration rate", () => {
    expect(project(1000, 0.99)).toBeLessThan(project(1000, 0.998));
  });
});

describe("rubberband", () => {
  it("is zero at the boundary", () => {
    expect(rubberband(0, 300)).toBe(0);
  });

  it("follows less than the pointer and never beyond the dimension", () => {
    expect(rubberband(100, 300)).toBeLessThan(100);
    expect(rubberband(100, 300)).toBeGreaterThan(0);
    expect(rubberband(10_000, 300)).toBeLessThan(300);
  });

  it("is symmetric", () => {
    expect(rubberband(-80, 300)).toBeCloseTo(-rubberband(80, 300));
  });
});

describe("velocityFromSamples", () => {
  it("needs two samples", () => {
    expect(velocityFromSamples([])).toBe(0);
    expect(velocityFromSamples([{ t: 0, y: 0 }])).toBe(0);
  });

  it("measures px per second over the recent window", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 50, y: 25 },
      { t: 100, y: 50 },
    ];
    expect(velocityFromSamples(samples)).toBeCloseTo(500);
  });

  it("ignores samples older than the window", () => {
    const samples = [
      { t: 0, y: 1000 },
      { t: 500, y: 0 },
      { t: 550, y: 10 },
    ];
    expect(velocityFromSamples(samples, 100)).toBeCloseTo(200);
  });
});

describe("clamp", () => {
  it("clamps both ways", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
