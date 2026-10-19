/**
 * The server export: one MP4 of a playlist made from the cloud copies the
 * way the desktop's export_playlist makes it from local files
 * (apps/desktop/src-tauri/src/lib.rs), with the desktop's argument lists as
 * packages/shared/lib/export-args.ts ports them:
 *
 *   each copy probed once (whether it has audio; how long it is) → each
 *   segment in playlist order into the work dir as seg_<i>.mp4: a clip cut
 *   straight from its copy's presigned GET, a card painted at the export's
 *   size (packages/node-video card-paint.ts) and looped for its duration →
 *   each checked (a clip at least EXPORT_MIN_SEGMENT_BYTES, as the desktop's
 *   assert_rendered_output, and probed within half a second of its window; a
 *   card at least CARD_MIN_SEGMENT_BYTES)
 *   → the concat pass, with the wordmark when asked (export.mp4) → the result
 *   probed → a share's poster frame (poster.jpg, at 0.6 s, else 0 s) → PUT
 *   video and poster to their presigned URLs, three tries each
 *   → { sizeBytes, durationSeconds, posterOk }.
 *
 * Progress: `clips` while the segments render (done / (segments + 1)),
 * `stitch` during the concat pass (ffmpeg's -progress over the expected
 * length, across the last 1 / (segments + 1)), `upload` (1).
 *
 * Failures are ExportFailure tokens for render_failed (each under the
 * function's 64 characters): a segment that fails on its own account is
 * `segment_failed:<n>` (n counts from 1, as the desktop's "Segment n of N";
 * not retryable), the concat pass `stitch_failed` and a full disk
 * `disk_full` (not retryable), a malformed plan `invalid_plan`; ffmpeg
 * missing or killed from outside (`ffmpeg_unavailable`, `ffmpeg_killed`), a
 * copy that can't be read (`source_unreachable`) and a refused upload
 * (`upload_failed`) are retryable: another attempt gets fresh URLs. A poster
 * that can't be made or uploaded only sets posterOk false, as on the desktop.
 * The signal kills ffmpeg (Aborted with its reason); every file made here is
 * removed however the export ends, except the outputs a dry run keeps.
 */
import { spawn } from "node:child_process";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WATERMARK_PNG } from "@scoutable/node-video/lib/assets";
import { FFMPEG, ProbeFailure, probeStreams, type StreamProbe } from "@scoutable/node-video/lib/ffmpeg";
import { POSTER_SEEKS, cardSegmentArgs, clipSegmentArgs, concatArgs, posterArgs, type ExportKeyframe } from "@scoutable/shared/lib/export-args";
import { parseProgressUs } from "@scoutable/shared/lib/game-video-convert";
import { EXPORT_MIN_SEGMENT_BYTES, exportFrameRate, type ExportAspect, type RenderExportPlan, type RenderExportSegment, type RenderPhase } from "@scoutable/shared/lib/game-video-wire";
import { Aborted, ConvertFailure, abortReason, throwIfAborted } from "./errors.ts";
import type { Logger } from "./log.ts";
import { ffmpegShipFailure, type FfmpegRun } from "./ship.ts";

/** How far a clip segment's probed length may sit from its window (clamped to the copy's end). */
export const EXPORT_DURATION_TOLERANCE_S = 0.5;
/**
 * A card segment's floor. EXPORT_MIN_SEGMENT_BYTES catches a cut with no
 * streams (a window past the copy's end: about 260 bytes), but a blank
 * one-second card is only 3.4–4.4 KB at 10–25 fps, so cards, which always
 * have frames, are held to a floor that still catches a track-less file.
 */
export const CARD_MIN_SEGMENT_BYTES = 1024;
const DEFAULT_PUT_TRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const VIDEO_PUT_TIMEOUT_MS = 20 * 60 * 1000;
const POSTER_PUT_TIMEOUT_MS = 60 * 1000;
const STDERR_KEEP = 8192;
const KILL_GRACE_MS = 2000;

/** A failure with the token render_failed carries and whether another attempt may succeed. */
export class ExportFailure extends ConvertFailure {
  constructor(
    token: string,
    retryable: boolean,
    detail?: string,
    /** The segment it is about, counting from 1. */
    public segment?: number,
  ) {
    super(token, retryable, detail);
    this.name = "ExportFailure";
  }
}

/** The token for segment n (from 1) failing on its own account. */
export const segmentFailedToken = (n: number) => `segment_failed:${n}`;

/** What a card is painted from: the plan's card segment. */
export interface CardSource {
  text: string;
  card: unknown | null;
}

/** The outside world, so the pipeline can be tested with a fake ffmpeg and a fake PUT. */
export interface ExportDeps {
  /**
   * Runs ffmpeg with the arguments; resolves when it exits, rejects only when
   * it can't be spawned. With `onProgressUs` the run reports its output time
   * (the runner adds `-nostats -progress pipe:1`).
   */
  runFfmpeg: (args: string[], signal: AbortSignal, onProgressUs?: (us: number) => void) => Promise<FfmpegRun>;
  /** A copy's or a rendered file's streams and length; throws (ProbeFailure) when it can't be read. */
  probe: (input: string, signal: AbortSignal) => Promise<StreamProbe>;
  /** The card as a PNG of the export's size. */
  paintCard: (source: CardSource, aspect: ExportAspect) => Promise<Buffer>;
  writeFile: (path: string, bytes: Buffer) => Promise<void>;
  fileSize: (path: string) => Promise<number>;
  readFile: (path: string) => Promise<Buffer>;
  /** PUTs the bytes to a presigned URL; resolves with the HTTP status, rejects on a network failure. */
  put: (url: string, body: Buffer, contentType: string, signal: AbortSignal, timeoutMs: number) => Promise<number>;
  remove: (path: string) => Promise<void>;
}

export interface ExportSegmentOutcome {
  /** From 0, in the plan's order. */
  index: number;
  total: number;
  kind: RenderExportSegment["kind"];
  /** The segment's probed length (a card's: its duration). */
  seconds: number;
  bytes: number;
}

export type ExportProgressDetail = {
  /** Segments rendered so far, of `total`. */
  done: number;
  total: number;
};

export interface ExportOptions {
  plan: RenderExportPlan;
  /** Presigned GETs of the copies, by game_videos id (render_take's `copies`); local paths in a dry run. */
  copies: Record<string, { url: string }>;
  workDir: string;
  signal: AbortSignal;
  deps?: Partial<ExportDeps>;
  /** The ffmpeg binary for the default runner. */
  ffmpeg?: string;
  /** The wordmark PNG (default: packages/node-video/assets/watermark.png). */
  watermarkPng?: string;
  /** False for a dry run: nothing is PUT and the export (and a share's poster) stay in the work dir. */
  upload?: boolean;
  putTries?: number;
  retryDelayMs?: number;
  onProgress?: (phase: RenderPhase, value: number, detail: ExportProgressDetail) => void;
  onSegment?: (outcome: ExportSegmentOutcome) => void;
  log?: Logger;
}

export interface ExportOutcome {
  sizeBytes: number;
  durationSeconds: number;
  posterOk: boolean;
  /** The files, for a dry run (removed after an upload). */
  videoPath: string;
  posterPath: string | null;
  segments: ExportSegmentOutcome[];
}

// ── the real dependencies ─────────────────────────────────────────────────────

function runFfmpegWith(ffmpeg: string): ExportDeps["runFfmpeg"] {
  return (args, signal, onProgressUs) =>
    new Promise<FfmpegRun>((resolve, reject) => {
      const argv = onProgressUs ? ["-nostats", "-progress", "pipe:1", ...args] : args;
      const child = spawn(ffmpeg, argv, { stdio: ["ignore", onProgressUs ? "pipe" : "ignore", "pipe"] });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (s: string) => {
        stderr = (stderr + s).slice(-STDERR_KEEP);
      });
      const lines = onProgressUs && child.stdout ? createInterface({ input: child.stdout }) : null;
      lines?.on("line", (line) => {
        const us = parseProgressUs(line);
        if (us !== null) onProgressUs?.(us);
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
        lines?.close();
        reject(e);
      });
      child.once("close", (code, sig) => {
        signal.removeEventListener("abort", kill);
        lines?.close();
        resolve({ code, signal: sig, stderr });
      });
    });
}

type Painter = typeof import("@scoutable/node-video/lib/card-paint");
let painter: Promise<Painter> | null = null;

/** The painter (and its native canvas) loads with the first card, so a broken canvas never stops a ship job. */
async function loadPainter(): Promise<Painter> {
  try {
    painter ??= import("@scoutable/node-video/lib/card-paint");
    return await painter;
  } catch (e) {
    painter = null;
    throw new ExportFailure("card_painter_unavailable", false, e instanceof Error ? e.message : String(e));
  }
}

export function defaultExportDeps(ffmpeg: string = FFMPEG): ExportDeps {
  return {
    runFfmpeg: runFfmpegWith(ffmpeg),
    probe: (input, signal) => probeStreams(input, { signal }),
    paintCard: async (source, aspect) => (await loadPainter()).paintCardPng(source, aspect),
    writeFile: (path, bytes) => writeFile(path, bytes),
    fileSize: async (path) => (await stat(path)).size,
    readFile: (path) => readFile(path),
    put: async (url, body, contentType, signal, timeoutMs) => {
      const res = await fetch(url, {
        method: "PUT",
        body,
        headers: { "content-type": contentType },
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      await res.body?.cancel().catch(() => {});
      return res.status;
    },
    remove: (path) => rm(path, { force: true }),
  };
}

// ── the plan ──────────────────────────────────────────────────────────────────

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The plan as render_take sent it, checked: anything malformed is `invalid_plan` (another attempt would get the same). */
export function checkExportPlan(plan: RenderExportPlan | undefined | null, upload: boolean): RenderExportPlan {
  const bad = (detail: string) => new ExportFailure("invalid_plan", false, detail);
  if (!plan || typeof plan !== "object") throw bad("render_take carried no export plan");
  if (plan.aspect !== "16:9" && plan.aspect !== "9:16") throw bad(`aspect ${String(plan.aspect)}`);
  if (plan.purpose !== "download" && plan.purpose !== "share") throw bad(`purpose ${String(plan.purpose)}`);
  // The rate goes into a filter string: ffmpeg rate syntax only.
  // "" = the copy's row had no frame rate (desktop-made copies): the probe decides.
  if (typeof plan.rate !== "string" || (plan.rate !== "" && !/^\d{1,6}(?:\/\d{1,6})?$/.test(plan.rate))) throw bad(`rate ${String(plan.rate)}`);
  if (!Array.isArray(plan.segments) || plan.segments.length === 0) throw bad("no segments");
  if (upload && (typeof plan.put?.video !== "string" || plan.put.video === "")) throw bad("no PUT URL for the video");
  const segments = plan.segments.map((raw, i): RenderExportSegment => {
    const s = raw as Partial<RenderExportSegment> & Record<string, unknown>;
    if (s?.kind === "clip") {
      if (typeof s.videoId !== "string" || !finite(s.start) || !finite(s.end) || !(s.end > s.start)) throw bad(`segment ${i + 1}: a clip needs videoId and start < end`);
      // A keyframe that isn't two numbers can't be drawn; the pan goes on without it.
      const keyframes = Array.isArray(s.keyframes) ? (s.keyframes as unknown[]).filter((k): k is ExportKeyframe => finite((k as ExportKeyframe)?.t) && finite((k as ExportKeyframe)?.cx)) : null;
      return { kind: "clip", matchId: String(s.matchId ?? ""), eventId: finite(s.eventId) ? s.eventId : 0, videoId: s.videoId, start: s.start, end: s.end, keyframes };
    }
    if (s?.kind === "card") {
      if (!finite(s.durationSeconds) || s.durationSeconds <= 0) throw bad(`segment ${i + 1}: a card needs a positive durationSeconds`);
      return { kind: "card", durationSeconds: s.durationSeconds, text: typeof s.text === "string" ? s.text : "", card: s.card ?? null };
    }
    throw bad(`segment ${i + 1}: kind ${String(s?.kind)}`);
  });
  return { ...plan, watermark: plan.watermark === true, segments };
}

export interface DryRunExport {
  copies: Record<string, { url: string }>;
  plan: RenderExportPlan;
  /** False when the plan named no rate: the caller probes the first clip's copy for it (exportFrameRate). */
  rateGiven: boolean;
}

/**
 * DRY_RUN_EXPORT's JSON: `{ copies: { <videoId>: <path or URL> | { url } }, aspect,
 * purpose, watermark, rate?, title?, segments }`, or a render_take response's
 * `{ copies, export }`. A clip may leave out matchId, eventId and keyframes, a
 * card its text and spec. The plan is checked later, by renderExport.
 */
export function parseDryRunExport(text: string): DryRunExport {
  const raw = JSON.parse(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw new Error("DRY_RUN_EXPORT needs a JSON object");
  const body = (raw.export && typeof raw.export === "object" ? raw.export : raw) as Record<string, unknown>;
  const copies: Record<string, { url: string }> = {};
  for (const [id, v] of Object.entries((raw.copies ?? {}) as Record<string, unknown>)) {
    const url = typeof v === "string" ? v : typeof (v as { url?: unknown })?.url === "string" ? (v as { url: string }).url : null;
    if (!url) throw new Error(`DRY_RUN_EXPORT copy ${id}: give a path, a URL or { url }`);
    copies[id] = { url };
  }
  const segments = Array.isArray(body.segments)
    ? (body.segments as Record<string, unknown>[]).map((s, i) =>
        s?.kind === "clip" ? { matchId: "dry-run", eventId: i, keyframes: null, ...s } : s?.kind === "card" ? { text: "", card: null, ...s } : s,
      )
    : body.segments;
  const rateGiven = typeof body.rate === "string" && body.rate !== "";
  const plan = {
    aspect: body.aspect ?? "16:9",
    purpose: body.purpose ?? "download",
    watermark: body.watermark === true,
    rate: rateGiven ? body.rate : "30",
    title: typeof body.title === "string" ? body.title : "Dry run",
    segments,
    put: { video: "" },
    keys: { video: "dry-run/export.mp4" },
  } as RenderExportPlan;
  return { copies, plan, rateGiven };
}

// ── the pipeline ──────────────────────────────────────────────────────────────

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
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function renderExport(o: ExportOptions): Promise<ExportOutcome> {
  const deps: ExportDeps = { ...defaultExportDeps(o.ffmpeg), ...o.deps };
  const upload = o.upload !== false;
  const plan = checkExportPlan(o.plan, upload);
  const { aspect } = plan;
  let rate = plan.rate;
  const total = plan.segments.length;
  const made = new Set<string>();
  const keep = new Set<string>();
  const track = (name: string) => {
    const path = join(o.workDir, name);
    made.add(path);
    return path;
  };
  const drop = async (path: string) => {
    await deps.remove(path).catch(() => {});
    made.delete(path);
  };

  /** One ffmpeg run, with the failures that aren't the arguments' fault named. */
  const run = async (args: string[], what: string, onProgressUs?: (us: number) => void): Promise<FfmpegRun> => {
    let r: FfmpegRun;
    try {
      r = await deps.runFfmpeg(args, o.signal, onProgressUs);
    } catch (e) {
      throwIfAborted(o.signal);
      throw new ExportFailure("ffmpeg_unavailable", true, `${what}: ${message(e)}`);
    }
    throwIfAborted(o.signal);
    if (r.code === null) throw new ExportFailure("ffmpeg_killed", true, `${what}: ffmpeg was killed (${r.signal ?? "no exit code"})`);
    if (r.code !== 0 && /No space left on device/i.test(r.stderr)) throw new ExportFailure("disk_full", false, `${what}: ${lastLine(r.stderr)}`);
    return r;
  };

  const putWithTries = async (url: string, body: Buffer, contentType: string, timeoutMs: number): Promise<string | null> => {
    const tries = Math.max(1, o.putTries ?? DEFAULT_PUT_TRIES);
    let last = "";
    for (let n = 1; n <= tries; n++) {
      throwIfAborted(o.signal);
      try {
        const status = await deps.put(url, body, contentType, o.signal, timeoutMs);
        if (status >= 200 && status < 300) return null;
        last = `http ${status}`;
        // A refused signature or key won't change on a repeat within this attempt.
        if (status >= 400 && status < 500 && status !== 429) break;
      } catch (e) {
        if (o.signal.aborted) throw new Aborted(abortReason(o.signal));
        last = message(e);
      }
      if (n < tries) await sleep((o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * n, o.signal);
    }
    return last || "failed";
  };

  try {
    // Each copy once: its audio decides whether a clip gets silence, its length bounds what a clip can hold.
    const probes = new Map<string, StreamProbe>();
    for (const seg of plan.segments) {
      if (seg.kind !== "clip" || probes.has(seg.videoId)) continue;
      throwIfAborted(o.signal);
      const url = o.copies[seg.videoId]?.url;
      if (!url) throw new ExportFailure("source_unreachable", true, `the plan names no copy for video ${seg.videoId}`);
      try {
        probes.set(seg.videoId, await deps.probe(url, o.signal));
      } catch (e) {
        throwIfAborted(o.signal);
        if (e instanceof ProbeFailure && e.reason === "ffmpeg_unavailable") throw new ExportFailure("ffmpeg_unavailable", true, e.message);
        throw new ExportFailure("source_unreachable", true, `copy of video ${seg.videoId}: ${message(e)}`);
      }
    }

    // No rate in the plan: the first clip's copy sets it, as the desktop's
    // export_frame_rate takes it from the first clip's source.
    if (rate === "") {
      const first = plan.segments.find((seg) => seg.kind === "clip");
      rate = exportFrameRate(first && first.kind === "clip" ? (probes.get(first.videoId)?.fps ?? null) : null);
    }

    o.onProgress?.("clips", 0, { done: 0, total });
    const files: string[] = [];
    const outcomes: ExportSegmentOutcome[] = [];
    let expectedTotal = 0;
    for (let i = 0; i < total; i++) {
      throwIfAborted(o.signal);
      const seg = plan.segments[i];
      const n = i + 1;
      const label = `segment ${n} of ${total}`;
      const fail = (detail: string) => new ExportFailure(segmentFailedToken(n), false, `${label} (${seg.kind}): ${detail}`, n);
      const out = track(`seg_${i}.mp4`);
      let seconds: number;

      if (seg.kind === "clip") {
        const copy = probes.get(seg.videoId)!;
        const args = clipSegmentArgs({
          input: o.copies[seg.videoId].url,
          start: seg.start,
          end: seg.end,
          aspect,
          rate,
          keyframes: aspect === "9:16" ? seg.keyframes : null,
          hasAudio: copy.hasAudio,
          output: out,
        });
        const r = await run(args, label);
        if (r.code !== 0) {
          if (ffmpegShipFailure(r.stderr) === "source_unreachable") throw new ExportFailure("source_unreachable", true, `${label}: ${lastLine(r.stderr)}`);
          throw fail(`ffmpeg exited with ${r.code}: ${lastLine(r.stderr)}`);
        }
        const bytes = await deps.fileSize(out).catch(() => 0);
        if (bytes < EXPORT_MIN_SEGMENT_BYTES) throw fail(`rendered empty (${bytes} bytes); its window is probably outside the copy`);
        // A window running past the copy's end holds what is there, as on the desktop.
        const end = copy.durationSeconds !== null ? Math.min(seg.end, copy.durationSeconds) : seg.end;
        const want = Math.max(end - seg.start, 0);
        const probed = await deps.probe(out, o.signal).then((p) => p.durationSeconds, () => null);
        throwIfAborted(o.signal);
        if (probed === null || Math.abs(probed - want) > EXPORT_DURATION_TOLERANCE_S) {
          throw fail(`${probed === null ? "unreadable" : `${probed.toFixed(2)} s`}, wanted ${want.toFixed(2)} s`);
        }
        seconds = probed;
        outcomes.push({ index: i, total, kind: "clip", seconds, bytes });
      } else {
        const png = track(`card_${i}.png`);
        let image: Buffer;
        try {
          image = await deps.paintCard({ text: seg.text, card: seg.card }, aspect);
        } catch (e) {
          if (e instanceof ExportFailure) throw e;
          throw fail(`the card could not be drawn: ${message(e)}`);
        }
        await deps.writeFile(png, image);
        const r = await run(cardSegmentArgs({ png, durationSeconds: seg.durationSeconds, rate, output: out }), label);
        await drop(png);
        if (r.code !== 0) throw fail(`ffmpeg exited with ${r.code}: ${lastLine(r.stderr)}`);
        const bytes = await deps.fileSize(out).catch(() => 0);
        if (bytes < CARD_MIN_SEGMENT_BYTES) throw fail(`rendered empty (${bytes} bytes)`);
        seconds = seg.durationSeconds;
        outcomes.push({ index: i, total, kind: "card", seconds, bytes });
      }
      expectedTotal += seconds;
      files.push(out);
      o.onSegment?.(outcomes[outcomes.length - 1]);
      o.onProgress?.("clips", n / (total + 1), { done: n, total });
    }

    // One pass over every segment, the wordmark on top (lib.rs export_playlist's last step).
    const video = track("export.mp4");
    const args = concatArgs({ inputs: files, watermarkPng: plan.watermark ? (o.watermarkPng ?? WATERMARK_PNG) : null, aspect, rate, output: video });
    const stitchAt = (fraction: number) => o.onProgress?.("stitch", (total + Math.min(1, Math.max(0, fraction))) / (total + 1), { done: total, total });
    stitchAt(0);
    const stitched = await run(args, "stitch", (us) => stitchAt(expectedTotal > 0 ? us / 1e6 / expectedTotal : 0));
    if (stitched.code !== 0) throw new ExportFailure("stitch_failed", false, `ffmpeg exited with ${stitched.code}: ${lastLine(stitched.stderr)}`);
    for (const f of files) await drop(f);

    const sizeBytes = await deps.fileSize(video).catch(() => 0);
    if (sizeBytes < EXPORT_MIN_SEGMENT_BYTES) throw new ExportFailure("stitch_failed", false, `the export rendered empty (${sizeBytes} bytes)`);
    const durationSeconds = await deps.probe(video, o.signal).then((p) => p.durationSeconds, () => null);
    throwIfAborted(o.signal);
    if (durationSeconds === null) throw new ExportFailure("stitch_failed", false, "the export can't be read back");

    // A share's poster: past the fade-in, else the first frame (lib.rs extract_poster_frame). Best effort.
    let posterPath: string | null = null;
    if (plan.purpose === "share") {
      const poster = track("poster.jpg");
      for (const at of POSTER_SEEKS) {
        try {
          const r = await run(posterArgs(video, poster, at), "poster");
          if (r.code === 0 && (await deps.fileSize(poster).catch(() => 0)) > 0) {
            posterPath = poster;
            break;
          }
        } catch (e) {
          if (e instanceof Aborted) throw e;
        }
      }
      if (!posterPath) o.log?.({ phase: "poster", ok: false, note: "no frame could be taken; the link goes out without a poster" });
    }

    let posterOk = false;
    if (upload) {
      o.onProgress?.("upload", 1, { done: total, total });
      const failed = await putWithTries(plan.put.video, await deps.readFile(video), "video/mp4", VIDEO_PUT_TIMEOUT_MS);
      if (failed !== null) throw new ExportFailure("upload_failed", true, `video: ${failed}`);
      if (posterPath && plan.put.poster) {
        const posterFailed = await putWithTries(plan.put.poster, await deps.readFile(posterPath), "image/jpeg", POSTER_PUT_TIMEOUT_MS);
        posterOk = posterFailed === null;
        if (posterFailed !== null) o.log?.({ phase: "poster", ok: false, upload: posterFailed });
      } else if (posterPath) {
        o.log?.({ phase: "poster", ok: false, note: "the plan has no PUT URL for the poster" });
      }
    } else {
      // A dry run: the files stay for a look.
      keep.add(video);
      if (posterPath) keep.add(posterPath);
      posterOk = posterPath !== null;
    }
    return { sizeBytes, durationSeconds, posterOk, videoPath: video, posterPath, segments: outcomes };
  } finally {
    for (const path of made) if (!keep.has(path)) await deps.remove(path).catch(() => {});
  }
}
