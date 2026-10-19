/**
 * Shipping a playlist's clips: each clip is cut from a presigned GET of the
 * cloud copy with the desktop's exact ffmpeg arguments (shipClipArgs) into a
 * temp file, checked (at least SHIP_MIN_OUTPUT_BYTES, probed within half a
 * second of the window asked for) and PUT to its presigned URL in the public
 * media bucket as video/mp4, three tries. Three clips at a time; a first pass
 * over every clip, then one retry pass over those that failed. A clip's
 * failure is a per-clip result, never the job's — unless every clip failed
 * for reasons outside the clips themselves (the copy unreachable, every PUT
 * refused, no ffmpeg), when the job is handed back for another attempt.
 */
import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { parallel } from "@scoutable/node-video/lib/detect-local";
import { FFMPEG, probe } from "@scoutable/node-video/lib/ffmpeg";
import { SHIP_MIN_OUTPUT_BYTES, shipClipArgs } from "@scoutable/shared/lib/game-video-convert";
import type { RenderClipResult, RenderShipClip } from "@scoutable/shared/lib/game-video-wire";
import { Aborted, abortReason, throwIfAborted } from "./errors.ts";
import type { Logger } from "./log.ts";

/** How far the cut's probed length may sit from the window asked for. */
export const SHIP_DURATION_TOLERANCE_S = 0.5;
const DEFAULT_PARALLEL = 3;
const DEFAULT_PUT_TRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const PUT_TIMEOUT_MS = 5 * 60 * 1000;
const STDERR_KEEP = 8192;
const KILL_GRACE_MS = 2000;

export interface FfmpegRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/** The outside world, so the pass logic can be tested with a fake ffmpeg and a fake PUT. */
export interface ShipDeps {
  /** Runs ffmpeg with the arguments; resolves when it exits, rejects only when it can't be spawned. */
  runFfmpeg: (args: string[], signal: AbortSignal) => Promise<FfmpegRun>;
  /** The cut's probed duration in seconds, or null when ffmpeg can't read the file. */
  probeDuration: (path: string) => Promise<number | null>;
  fileSize: (path: string) => Promise<number>;
  readFile: (path: string) => Promise<Buffer>;
  /** PUTs the bytes to a presigned URL; resolves with the HTTP status, rejects on a network failure. */
  put: (url: string, body: Buffer, contentType: string, signal: AbortSignal) => Promise<number>;
  remove: (path: string) => Promise<void>;
}

/** Why a clip could not be shipped. */
export type ShipFailure = "ffmpeg_unavailable" | "source_unreachable" | "cut_failed" | "output_too_small" | "duration_mismatch" | "upload_failed";

/** Failures the clip itself can't be blamed for: another attempt, with fresh URLs, may well succeed. */
const INFRASTRUCTURE_FAILURES: ReadonlySet<ShipFailure> = new Set(["ffmpeg_unavailable", "source_unreachable", "upload_failed"]);

export function isInfrastructureFailure(error: ShipFailure): boolean {
  return INFRASTRUCTURE_FAILURES.has(error);
}

/**
 * What a non-zero ffmpeg exit means for the clip. Trouble reaching the copy
 * over HTTP is the infrastructure's (an expired URL, a dropped connection);
 * anything else is read as the cut itself failing (a window past the copy's
 * end, unreadable data), which another attempt would repeat.
 */
export function ffmpegShipFailure(stderr: string): ShipFailure {
  if (/Server returned \d{3}|HTTP error|Failed to resolve hostname|Temporary failure in name resolution|Connection refused|Connection reset|Connection timed out|Network is unreachable|Error in the pull function|Input\/output error/i.test(stderr)) {
    return "source_unreachable";
  }
  return "cut_failed";
}

export interface ShipClipOutcome {
  clip: RenderShipClip;
  ok: boolean;
  error?: ShipFailure;
  /** For the log only; the wire carries the token. */
  detail?: string;
  durationS?: number;
  bytes?: number;
}

export interface ShipOutcome {
  outcomes: ShipClipOutcome[];
  /** One per clip, in the plan's order: what render_done is told. */
  results: RenderClipResult[];
  shipped: number;
  failed: number;
  /** Every clip failed, none for a reason of its own: the job should be handed back for another attempt. */
  infrastructureOnly: boolean;
}

export interface ShipOptions {
  /** Presigned GETs of the copies, by game_videos id (render_take's `copies`). */
  copies: Record<string, { url: string }>;
  clips: RenderShipClip[];
  workDir: string;
  signal: AbortSignal;
  deps?: Partial<ShipDeps>;
  /** The ffmpeg binary for the default runner. */
  ffmpeg?: string;
  parallel?: number;
  putTries?: number;
  retryDelayMs?: number;
  /** After every attempt on a clip: how many clips the first pass has settled, the total, and this clip's outcome. */
  onClipDone?: (done: number, total: number, outcome: ShipClipOutcome) => void;
  log?: Logger;
}

// ── the real dependencies ─────────────────────────────────────────────────────

function runFfmpegWith(ffmpeg: string): ShipDeps["runFfmpeg"] {
  return (args, signal) =>
    new Promise<FfmpegRun>((resolve, reject) => {
      const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (s: string) => {
        stderr = (stderr + s).slice(-STDERR_KEEP);
      });
      const kill = () => {
        if (child.exitCode !== null) return;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, KILL_GRACE_MS).unref();
      };
      if (signal.aborted) kill();
      else signal.addEventListener("abort", kill, { once: true });
      child.once("error", (e) => {
        signal.removeEventListener("abort", kill);
        reject(e);
      });
      child.once("close", (code, sig) => {
        signal.removeEventListener("abort", kill);
        resolve({ code, signal: sig, stderr });
      });
    });
}

export function defaultShipDeps(ffmpeg: string = FFMPEG): ShipDeps {
  return {
    runFfmpeg: runFfmpegWith(ffmpeg),
    probeDuration: async (path) => (await probe(path))?.durationS ?? null,
    fileSize: async (path) => (await stat(path)).size,
    readFile: (path) => readFile(path),
    put: async (url, body, contentType, signal) => {
      const res = await fetch(url, {
        method: "PUT",
        body,
        headers: { "content-type": contentType },
        signal: AbortSignal.any([signal, AbortSignal.timeout(PUT_TIMEOUT_MS)]),
      });
      await res.body?.cancel().catch(() => {});
      return res.status;
    },
    remove: (path) => rm(path, { force: true }),
  };
}

// ── one clip ──────────────────────────────────────────────────────────────────

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

const lastLine = (stderr: string) => stderr.trim().split("\n").pop() ?? "";

async function cutAndPut(o: ShipOptions, deps: ShipDeps, clip: RenderShipClip, index: number): Promise<ShipClipOutcome> {
  const fail = (error: ShipFailure, detail: string): ShipClipOutcome => ({ clip, ok: false, error, detail });
  const copyUrl = o.copies[clip.videoId]?.url;
  if (!copyUrl) return fail("source_unreachable", "the plan names no copy for this clip's video");
  const out = join(o.workDir, `${index}.mp4`);
  try {
    let run: FfmpegRun;
    try {
      run = await deps.runFfmpeg(shipClipArgs(copyUrl, clip.start, clip.end, out), o.signal);
    } catch (e) {
      throwIfAborted(o.signal);
      return fail("ffmpeg_unavailable", e instanceof Error ? e.message : String(e));
    }
    throwIfAborted(o.signal);
    if (run.code !== 0) return fail(ffmpegShipFailure(run.stderr), `ffmpeg exited with ${run.code ?? run.signal}: ${lastLine(run.stderr)}`);

    const bytes = await deps.fileSize(out).catch(() => 0);
    if (bytes < SHIP_MIN_OUTPUT_BYTES) return fail("output_too_small", `${bytes} bytes`);
    const want = clip.end - clip.start;
    const durationS = await deps.probeDuration(out);
    if (durationS === null || !Number.isFinite(durationS) || Math.abs(durationS - want) > SHIP_DURATION_TOLERANCE_S) {
      return fail("duration_mismatch", `${durationS === null ? "unreadable" : `${durationS.toFixed(2)} s`}, wanted ${want.toFixed(2)} s`);
    }

    const body = await deps.readFile(out);
    const tries = Math.max(1, o.putTries ?? DEFAULT_PUT_TRIES);
    let last = "";
    for (let n = 1; n <= tries; n++) {
      throwIfAborted(o.signal);
      try {
        const status = await deps.put(clip.putUrl, body, "video/mp4", o.signal);
        if (status >= 200 && status < 300) return { clip, ok: true, durationS, bytes };
        last = `http ${status}`;
        // A refused signature or key won't change on a repeat within this attempt.
        if (status >= 400 && status < 500 && status !== 429) break;
      } catch (e) {
        if (o.signal.aborted) throw new Aborted(abortReason(o.signal));
        last = e instanceof Error ? e.message : String(e);
      }
      if (n < tries) await sleep((o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * n, o.signal);
    }
    return fail("upload_failed", last);
  } finally {
    await deps.remove(out).catch(() => {});
  }
}

// ── the passes ────────────────────────────────────────────────────────────────

export async function shipClips(o: ShipOptions): Promise<ShipOutcome> {
  const deps: ShipDeps = { ...defaultShipDeps(o.ffmpeg), ...o.deps };
  const total = o.clips.length;
  const indexes = o.clips.map((_, i) => i);
  const outcomes = new Array<ShipClipOutcome>(total);
  const width = Math.max(1, o.parallel ?? DEFAULT_PARALLEL);
  let done = 0;

  const attempt = async (i: number, pass: 1 | 2) => {
    const outcome = await cutAndPut(o, deps, o.clips[i], i);
    outcomes[i] = outcome;
    if (pass === 1) done++;
    o.onClipDone?.(done, total, outcome);
  };

  await parallel(indexes, (i) => attempt(i, 1), width);
  const retry = indexes.filter((i) => !outcomes[i].ok);
  if (retry.length > 0) {
    throwIfAborted(o.signal);
    o.log?.({ phase: "retry", clips: retry.length, errors: [...new Set(retry.map((i) => outcomes[i].error))].join(",") });
    await parallel(retry, (i) => attempt(i, 2), width);
  }

  const results: RenderClipResult[] = outcomes.map((x) => ({
    matchId: x.clip.matchId,
    eventId: x.clip.eventId,
    key: x.clip.key,
    ok: x.ok,
    ...(x.ok ? {} : { error: x.error ?? "cut_failed" }),
  }));
  const shipped = outcomes.filter((x) => x.ok).length;
  return {
    outcomes,
    results,
    shipped,
    failed: total - shipped,
    infrastructureOnly: total > 0 && shipped === 0 && outcomes.every((x) => x.error !== undefined && isInfrastructureFailure(x.error)),
  };
}
