import assert from "node:assert/strict";
import { test } from "node:test";
import { Aborted, abortReason, classifyFailure } from "../src/errors.ts";
import { Cancelled, FunctionError, StaleAttempt } from "../src/function-client.ts";
import { createLogger } from "../src/log.ts";
import { startHeartbeat, throttledReporter } from "../src/runtime.ts";

test("throttledReporter: at once when the phase changes, otherwise at most once per interval", () => {
  let now = 0;
  let beats = 0;
  const report = throttledReporter<string>(() => beats++, 5000, () => now);
  report("clips"); // first
  report("clips"); // too soon
  now = 4999;
  report("clips"); // too soon
  now = 5000;
  report("clips"); // interval passed
  report("stitch"); // phase change
  report("stitch"); // too soon
  now = 6000;
  report("upload"); // phase change
  assert.equal(beats, 4);
});

const quiet = createLogger({ program: "render", id: "job-1", write: () => {} });
const settle = () => new Promise((r) => setTimeout(r, 5));

test("the heartbeat stops the run on cancelled and on stale_attempt, and only logs anything else", async () => {
  for (const [error, reason] of [
    [new Cancelled(), "cancelled"],
    [new StaleAttempt(), "stale_attempt"],
    [new FunctionError("storage_failed", 502), null],
  ] as const) {
    const abort = new AbortController();
    const heartbeat = startHeartbeat({ intervalMs: 60_000, progress: { value: 0.5, line: () => {} }, report: async () => Promise.reject(error), abort, log: quiet });
    heartbeat.beat();
    await settle();
    heartbeat.stop();
    assert.equal(abort.signal.aborted, reason !== null, String(error));
    if (reason) {
      assert.equal(abort.signal.reason, reason);
      assert.equal(abortReason(abort.signal), reason);
    }
  }
});

test("a cancelled abort reads back as cancelled", () => {
  const abort = new AbortController();
  abort.abort("cancelled");
  assert.equal(abortReason(abort.signal), "cancelled");
  assert.equal(new Aborted("cancelled").reason, "cancelled");
  // Anything else still reads as SIGTERM.
  const other = new AbortController();
  other.abort("something");
  assert.equal(abortReason(other.signal), "sigterm");
  assert.equal(classifyFailure(new Aborted("sigterm")).error, "sigterm");
});
