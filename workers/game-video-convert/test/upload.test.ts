import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ConvertFailure } from "../src/errors.ts";
import { uploadCopy } from "../src/upload.ts";

let dir = "";
let path = "";
const PART = 1024;
const SIZE = PART * 2 + 300; // three parts, the last one short
const data = Buffer.from(Array.from({ length: SIZE }, (_, i) => (i * 7) % 256));
const never = new AbortController().signal;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "upload-test-"));
  path = join(dir, "copy.mp4");
  await writeFile(path, data);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Put {
  url: string;
  body: Buffer;
}

/** A fake R2 that records the PUTs and can fail chosen attempts of a part (by path, whatever its signature). */
function bucket(failures: Record<string, number[]> = {}) {
  const puts: Put[] = [];
  const attempts = new Map<string, number>();
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const key = new URL(url).pathname;
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    const status = failures[key]?.[n - 1];
    if (status) return new Response("nope", { status });
    puts.push({ url, body: Buffer.from(init?.body as Uint8Array) });
    return new Response(null, { status: 200, headers: { etag: `"etag-${key.slice(1)}-${n}"` } });
  }) as typeof fetch;
  return { fetch: fetchFn, puts };
}

test("uploads every part to its signed URL and returns bare ETags in order", async () => {
  const b = bucket();
  const signed: number[][] = [];
  const parts = await uploadCopy({
    path,
    sizeBytes: SIZE,
    partSize: PART,
    signal: never,
    fetch: b.fetch,
    sign: async (ns) => {
      signed.push(ns);
      return ns.map((n) => ({ partNumber: n, url: `https://r2.invalid/p${n}?sig=1` }));
    },
  });
  assert.deepEqual(signed, [[1, 2, 3]]);
  assert.deepEqual(parts, [
    { partNumber: 1, etag: "etag-p1-1" },
    { partNumber: 2, etag: "etag-p2-1" },
    { partNumber: 3, etag: "etag-p3-1" },
  ]);
  const byPart = new Map(b.puts.map((p) => [new URL(p.url).pathname, p.body]));
  assert.ok(byPart.get("/p1")!.equals(data.subarray(0, PART)));
  assert.ok(byPart.get("/p3")!.equals(data.subarray(2 * PART)));
});

test("a 403 re-signs that part before the retry; other failures retry with the same URL", async () => {
  const b = bucket({ "/p2": [403], "/p3": [500] });
  const signed: number[][] = [];
  let version = 0;
  const retries: number[] = [];
  const parts = await uploadCopy({
    path,
    sizeBytes: SIZE,
    partSize: PART,
    signal: never,
    fetch: b.fetch,
    retryDelayMs: 1,
    onRetry: (n) => retries.push(n),
    sign: async (ns) => {
      signed.push(ns);
      version++;
      return ns.map((n) => ({ partNumber: n, url: `https://r2.invalid/p${n}?v=${version}` }));
    },
  });
  assert.deepEqual(signed, [[1, 2, 3], [2]]);
  assert.deepEqual(retries.sort(), [2, 3]);
  assert.equal(parts.length, 3);
  assert.ok(b.puts.some((p) => p.url === "https://r2.invalid/p2?v=2"));
});

test("a part that keeps failing ends the upload as upload_failed", async () => {
  const b = bucket({ "/p1": [500, 500, 500] });
  await assert.rejects(
    uploadCopy({ path, sizeBytes: SIZE, partSize: PART, signal: never, fetch: b.fetch, retryDelayMs: 1, tries: 3, sign: async (ns) => ns.map((n) => ({ partNumber: n, url: `https://r2.invalid/p${n}` })) }),
    (e) => e instanceof ConvertFailure && e.token === "upload_failed" && e.retryable,
  );
});
