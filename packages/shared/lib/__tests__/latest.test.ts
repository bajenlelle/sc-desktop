import { describe, expect, it } from "vitest";
import { createLatestRuns, newestRequest } from "../latest";

describe("createLatestRuns", () => {
  it("stops the older run for a key the moment a newer one starts", () => {
    const runs = createLatestRuns();
    const first = runs.start("m1");
    expect(first.aborted).toBe(false);
    const second = runs.start("m1");
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it("leaves runs for other keys alone, and forgets a run that finished", () => {
    const runs = createLatestRuns();
    const a = runs.start("m1");
    runs.start("m2");
    expect(a.aborted).toBe(false);
    runs.finish("m1", a);
    expect(runs.isRunning("m1")).toBe(false);
    expect(runs.isRunning("m2")).toBe(true);
  });

  it("doesn't forget a newer run when an older one finishes", () => {
    const runs = createLatestRuns();
    const old = runs.start("m1");
    runs.start("m1");
    runs.finish("m1", old);
    expect(runs.isRunning("m1")).toBe(true);
  });
});

describe("newestRequest", () => {
  it("takes the request made last", () => {
    expect(newestRequest({ seconds: 1, nonce: 5 }, { seconds: 2, nonce: 9 })).toEqual({ seconds: 2, nonce: 9 });
    expect(newestRequest({ seconds: 1, nonce: 9 }, { seconds: 2, nonce: 5 })).toEqual({ seconds: 1, nonce: 9 });
  });

  it("takes whichever exists", () => {
    expect(newestRequest(null, { seconds: 2, nonce: 1 })).toEqual({ seconds: 2, nonce: 1 });
    expect(newestRequest(undefined, null)).toBeNull();
  });
});
