/**
 * The copy, uploaded as 32 MiB parts to presigned URLs the function signs
 * fifty at a time, three parts in flight, three tries each with a re-sign on
 * 403 — the desktop's loop (apps/desktop/src/lib/game-video.ts) in Node.
 */
import { open } from "node:fs/promises";
import { parallel } from "@scoutable/node-video/lib/detect-local";
import { GAME_VIDEO_SIGN_BATCH, bareEtag, partRange, planParts, type GameVideoPart } from "@scoutable/shared/lib/game-video-wire";
import { Aborted, ConvertFailure, abortReason, throwIfAborted } from "./errors.ts";

export interface UploadOptions {
  path: string;
  sizeBytes: number;
  partSize: number;
  signal: AbortSignal;
  sign: (partNumbers: number[]) => Promise<{ partNumber: number; url: string }[]>;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  onRetry?: (partNumber: number, attempt: number, error: unknown) => void;
  fetch?: typeof fetch;
  parallel?: number;
  tries?: number;
  partTimeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_PARALLEL = 3;
const DEFAULT_TRIES = 3;
const DEFAULT_PART_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 1000;

class PartStatus extends Error {
  constructor(public status: number) {
    super(`upload_status_${status}`);
    this.name = "PartStatus";
  }
}

async function putPart(url: string, body: Buffer, doFetch: typeof fetch, signal: AbortSignal, timeoutMs: number): Promise<string> {
  const res = await doFetch(url, { method: "PUT", body, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
  await res.body?.cancel().catch(() => {});
  if (!res.ok) throw new PartStatus(res.status);
  const etag = res.headers.get("etag");
  if (!etag) throw new Error("no ETag on the part response");
  return bareEtag(etag);
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

export async function uploadCopy(o: UploadOptions): Promise<GameVideoPart[]> {
  const plan = planParts(o.sizeBytes, o.partSize);
  const numbers = Array.from({ length: plan.count }, (_, i) => i + 1);
  const tries = o.tries ?? DEFAULT_TRIES;
  const doFetch = o.fetch ?? fetch;
  const urls = new Map<number, string>();
  const etags = new Map<number, string>();
  const sign = async (ns: number[]) => {
    for (const u of await o.sign(ns)) urls.set(u.partNumber, u.url);
  };
  let done = 0;
  const file = await open(o.path, "r");
  try {
    for (let i = 0; i < numbers.length; i += GAME_VIDEO_SIGN_BATCH) {
      throwIfAborted(o.signal);
      const batch = numbers.slice(i, i + GAME_VIDEO_SIGN_BATCH);
      await sign(batch);
      await parallel(
        batch,
        async (partNumber) => {
          const { offset, length } = partRange(partNumber, plan, o.sizeBytes);
          const body = Buffer.allocUnsafe(length);
          let read = 0;
          while (read < length) {
            const r = await file.read(body, read, length - read, offset + read);
            if (r.bytesRead === 0) throw new ConvertFailure("upload_failed", true, `the copy is shorter than its size says (part ${partNumber})`);
            read += r.bytesRead;
          }
          for (let attempt = 1; ; attempt++) {
            throwIfAborted(o.signal);
            try {
              const url = urls.get(partNumber);
              if (!url) throw new Error(`part ${partNumber} has no URL`);
              etags.set(partNumber, await putPart(url, body, doFetch, o.signal, o.partTimeoutMs ?? DEFAULT_PART_TIMEOUT_MS));
              done += length;
              o.onProgress?.(done, o.sizeBytes);
              return;
            } catch (e) {
              if (o.signal.aborted) throw new Aborted(abortReason(o.signal));
              if (e instanceof ConvertFailure) throw e;
              if (attempt >= tries) throw new ConvertFailure("upload_failed", true, `part ${partNumber}: ${e instanceof Error ? e.message : String(e)}`);
              o.onRetry?.(partNumber, attempt, e);
              // An expired URL answers 403: sign that part again before retrying.
              if (e instanceof PartStatus && e.status === 403) await sign([partNumber]);
              await sleep((o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * attempt, o.signal);
            }
          }
        },
        o.parallel ?? DEFAULT_PARALLEL,
      );
    }
  } finally {
    await file.close();
  }
  return [...etags.entries()].map(([partNumber, etag]) => ({ partNumber, etag })).sort((a, b) => a.partNumber - b.partNumber);
}
