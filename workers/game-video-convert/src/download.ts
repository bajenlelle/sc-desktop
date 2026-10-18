/**
 * The original, streamed from its presigned GET into the work directory.
 * A failed or stalled transfer resumes from the bytes already on disk with a
 * Range request, up to five tries; a 403 means the URL no longer opens the
 * object (expired or deleted), which the function names `source_unreadable`.
 */
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Aborted, ConvertFailure, abortReason, throwIfAborted } from "./errors.ts";

export interface DownloadOptions {
  url: string;
  sizeBytes: number;
  dest: string;
  signal: AbortSignal;
  onProgress?: (doneBytes: number) => void;
  onRetry?: (attempt: number, error: unknown) => void;
  tries?: number;
  /** No bytes for this long aborts the transfer, which then resumes. */
  idleMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_TRIES = 5;
const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 2000;

/** The total in a Content-Range header ("bytes 100-999/1000" → 1000), or null. */
export function contentRangeTotal(header: string | null): number | null {
  const m = header && /^bytes\s+(?:\d+-\d+|\*)\/(\d+)$/i.exec(header.trim());
  return m ? Number(m[1]) : null;
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function downloadSource(o: DownloadOptions): Promise<void> {
  const tries = o.tries ?? DEFAULT_TRIES;
  let last: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    throwIfAborted(o.signal);
    let have = await sizeOf(o.dest);
    if (have > o.sizeBytes) {
      await rm(o.dest, { force: true });
      have = 0;
    }
    if (have === o.sizeBytes) return;
    try {
      await fetchInto(o, have);
      const got = await sizeOf(o.dest);
      if (got === o.sizeBytes) return;
      last = new Error(`short download: ${got} of ${o.sizeBytes} bytes`);
    } catch (e) {
      if (e instanceof ConvertFailure || e instanceof Aborted) throw e;
      if (o.signal.aborted) throw new Aborted(abortReason(o.signal));
      last = e;
    }
    if (attempt < tries) {
      o.onRetry?.(attempt, last);
      await sleep((o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * attempt, o.signal);
    }
  }
  throw new ConvertFailure("source_unreadable", true, last instanceof Error ? last.message : String(last));
}

async function fetchInto(o: DownloadOptions, have: number): Promise<void> {
  const idle = new AbortController();
  const signal = AbortSignal.any([o.signal, idle.signal]);
  const idleMs = o.idleMs ?? DEFAULT_IDLE_MS;
  let timer = setTimeout(() => idle.abort("idle"), idleMs);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort("idle"), idleMs);
  };
  try {
    const res = await (o.fetch ?? fetch)(o.url, { headers: have > 0 ? { range: `bytes=${have}-` } : {}, signal });
    if (res.status === 403) throw new ConvertFailure("source_unreadable", true, "the original's URL answered 403");
    if (res.status === 404) throw new ConvertFailure("source_unreadable", false, "the original is gone (404)");
    if (res.status === 416) {
      // The bytes on disk don't fit the object: start over.
      await res.body?.cancel().catch(() => {});
      await rm(o.dest, { force: true });
      throw new Error("range not satisfiable");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`http ${res.status}`);
    }
    if (!res.body) throw new Error("empty body");
    // A server that ignores the Range answers 200 with the whole file.
    const append = have > 0 && res.status === 206;
    const total = append ? contentRangeTotal(res.headers.get("content-range")) : Number(res.headers.get("content-length")) || null;
    if (total !== null && total !== o.sizeBytes) {
      await res.body.cancel().catch(() => {});
      throw new ConvertFailure("source_unreadable", false, `the object is ${total} bytes, the row says ${o.sizeBytes}`);
    }
    let done = append ? have : 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        done += chunk.length;
        touch();
        o.onProgress?.(done);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), counter, createWriteStream(o.dest, { flags: append ? "a" : "w" }), { signal });
  } finally {
    clearTimeout(timer);
  }
}
