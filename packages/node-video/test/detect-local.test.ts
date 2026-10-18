import assert from "node:assert/strict";
import { test } from "node:test";
import type { Frame, FrameReading } from "@scoutable/shared/lib/tipoff-detect";
import { DetectError, outputWidth, parallel, readWithRetry, type FrameReader } from "../lib/detect-local.ts";
import { jpegSize, splitMjpeg } from "../lib/ffmpeg.ts";

const frames = (n: number): Frame[] => Array.from({ length: n }, (_, i) => ({ t: i, jpegBase64: "", width: 640, height: 360 }));
const reading = (index: number): FrameReading => ({ index, clockVisible: false, clock: null, clockRunning: null, period: null, state: "unknown", jumpBall: null });

test("outputWidth: whole frames at 640, crops at native resolution for HD, 2x for small sources", () => {
  assert.equal(outputWidth(1920), 640);
  assert.equal(outputWidth(1920, { x: 0.2, y: 0.8, w: 0.6, h: 0.2 }), 640);
  assert.equal(outputWidth(960, { x: 0.2, y: 0.8, w: 0.6, h: 0.2 }), 1152);
  assert.equal(outputWidth(640, { x: 0, y: 0, w: 0.02, h: 0.1 }), 64);
});

test("parallel: keeps input order and never exceeds the concurrency", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await parallel(
    [30, 5, 20, 1, 10],
    async (ms) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return ms * 2;
    },
    2,
  );
  assert.deepEqual(out, [60, 10, 40, 2, 20]);
  assert.equal(peak, 2);
  assert.deepEqual(await parallel([], async () => 1), []);
});

test("readWithRetry: a good answer is passed through", async () => {
  const read: FrameReader = async (fs) => ({ ok: true, data: { readings: fs.map((_, i) => reading(i)), usage: { model: "", inputTokens: 0, outputTokens: 0, latencyMs: 0 } } });
  const out = await readWithRetry(read, frames(3), "whole");
  assert.deepEqual(out.map((r) => r.index), [0, 1, 2]);
});

test("readWithRetry: a batch the function balks at is split once and re-indexed", async () => {
  const calls: number[] = [];
  const read: FrameReader = async (fs) => {
    calls.push(fs.length);
    if (fs.length > 8) return { ok: false, error: "too_many_frames" };
    return { ok: true, data: { readings: fs.map((_, i) => reading(i)), usage: { model: "", inputTokens: 0, outputTokens: 0, latencyMs: 0 } } };
  };
  const out = await readWithRetry(read, frames(15), "overlay");
  assert.deepEqual(calls, [15, 8, 7]);
  assert.deepEqual(out.map((r) => r.index), Array.from({ length: 15 }, (_, i) => i));
});

test("readWithRetry: a batch too small to split, or a token not worth retrying, throws the token", async () => {
  const failing = (token: string): FrameReader => async () => ({ ok: false, error: token });
  await assert.rejects(readWithRetry(failing("model_error"), frames(8), "whole"), (e) => e instanceof DetectError && e.token === "model_error");
  await assert.rejects(readWithRetry(failing("detection_disabled"), frames(40), "whole"), (e) => e instanceof DetectError && e.token === "detection_disabled");
});

test("splitMjpeg: splits a concatenated stream on SOI markers", () => {
  const a = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 9]);
  const parts = splitMjpeg(Buffer.concat([a, b]));
  assert.equal(parts.length, 2);
  assert.ok(parts[0].equals(a));
  assert.ok(parts[1].equals(b));
  assert.deepEqual(splitMjpeg(Buffer.alloc(0)), []);
});

test("jpegSize: reads the dimensions from the SOF0 marker", () => {
  // SOI, APP0 (length 4, empty), SOF0: length 11, precision 8, height 360, width 640, 1 component.
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00]);
  assert.deepEqual(jpegSize(buf), { width: 640, height: 360 });
  assert.deepEqual(jpegSize(Buffer.from([0xff, 0xd8])), { width: 0, height: 0 });
});
