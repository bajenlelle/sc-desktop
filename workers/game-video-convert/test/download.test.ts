import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { contentRangeTotal, downloadSource } from "../src/download.ts";
import { ConvertFailure } from "../src/errors.ts";

let dir = "";
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "download-test-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const payload = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));
const never = new AbortController().signal;

/** A fake origin that serves `payload` with Range support and runs a script of behaviours first. */
function origin(behaviours: ((range: string | null) => Response | null)[] = []) {
  const ranges: (string | null)[] = [];
  const fetchFn = (async (_input: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    ranges.push(range);
    const scripted = behaviours.shift();
    if (scripted) {
      const r = scripted(range);
      if (r) return r;
    }
    if (range) {
      const from = Number(/bytes=(\d+)-/.exec(range)![1]);
      return new Response(payload.subarray(from), { status: 206, headers: { "content-range": `bytes ${from}-${payload.length - 1}/${payload.length}` } });
    }
    return new Response(payload, { status: 200, headers: { "content-length": String(payload.length) } });
  }) as typeof fetch;
  return { fetch: fetchFn, ranges };
}

test("contentRangeTotal reads the total of a Content-Range header", () => {
  assert.equal(contentRangeTotal("bytes 100-999/1000"), 1000);
  assert.equal(contentRangeTotal("bytes */5"), 5);
  assert.equal(contentRangeTotal(null), null);
  assert.equal(contentRangeTotal("garbage"), null);
});

test("downloads the whole object in one go and reports progress", async () => {
  const dest = join(dir, "whole.bin");
  const o = origin();
  const seen: number[] = [];
  await downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length, dest, signal: never, fetch: o.fetch, onProgress: (n) => seen.push(n) });
  assert.ok((await readFile(dest)).equals(payload));
  assert.deepEqual(o.ranges, [null]);
  assert.equal(seen.at(-1), payload.length);
});

test("resumes from the bytes already on disk with a Range request", async () => {
  const dest = join(dir, "resume.bin");
  await writeFile(dest, payload.subarray(0, 4000));
  const o = origin();
  await downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length, dest, signal: never, fetch: o.fetch });
  assert.deepEqual(o.ranges, ["bytes=4000-"]);
  assert.ok((await readFile(dest)).equals(payload));
});

test("a transfer cut short is retried from where it stopped", async () => {
  const dest = join(dir, "short.bin");
  const o = origin([() => new Response(payload.subarray(0, 2500), { status: 200, headers: { "content-length": String(payload.length) } })]);
  const retries: number[] = [];
  await downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length, dest, signal: never, fetch: o.fetch, retryDelayMs: 1, onRetry: (n) => retries.push(n) });
  assert.deepEqual(o.ranges, [null, "bytes=2500-"]);
  assert.deepEqual(retries, [1]);
  assert.ok((await readFile(dest)).equals(payload));
});

test("a 403 is source_unreadable and retryable; a 404 is final", async () => {
  const forbidden = origin([() => new Response("denied", { status: 403 })]);
  await assert.rejects(
    downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length, dest: join(dir, "403.bin"), signal: never, fetch: forbidden.fetch }),
    (e) => e instanceof ConvertFailure && e.token === "source_unreadable" && e.retryable,
  );
  const gone = origin([() => new Response("gone", { status: 404 })]);
  await assert.rejects(
    downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length, dest: join(dir, "404.bin"), signal: never, fetch: gone.fetch }),
    (e) => e instanceof ConvertFailure && e.token === "source_unreadable" && !e.retryable,
  );
});

test("an object of another size than the row says is refused for good", async () => {
  const o = origin([() => new Response(payload, { status: 200, headers: { "content-length": String(payload.length) } })]);
  await assert.rejects(
    downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length + 1, dest: join(dir, "size.bin"), signal: never, fetch: o.fetch }),
    (e) => e instanceof ConvertFailure && e.token === "source_unreadable" && !e.retryable,
  );
});

test("gives up as source_unreadable after the tries run out", async () => {
  const o = origin(Array.from({ length: 3 }, () => () => new Response("busy", { status: 503 })));
  await assert.rejects(
    downloadSource({ url: "https://example.invalid/source", sizeBytes: payload.length, dest: join(dir, "503.bin"), signal: never, fetch: o.fetch, tries: 3, retryDelayMs: 1 }),
    (e) => e instanceof ConvertFailure && e.token === "source_unreadable" && e.retryable,
  );
  assert.equal(o.ranges.length, 3);
});
