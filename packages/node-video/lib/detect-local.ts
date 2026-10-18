/**
 * The local-video side of the tip-off detector and the content fingerprint,
 * for Node programs: frames come from `ffmpeg.ts`, readings from the deployed
 * `tipoff-detect` function as the signed-in bot user. The nightly BasketTV
 * job and the cloud converter share this; the desktop has the same wiring
 * over its Tauri sidecar (apps/desktop/src/lib/tipoff-detect.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DetectDeps, Frame, FrameReading, FrameView, OverlayBox } from "@scoutable/shared/lib/tipoff-detect";
import { locateOverlay, readFrames, type ReadFramesResponse, type TipoffDetectResult } from "@scoutable/shared/lib/tipoff-detect-client";
import {
  FINGERPRINT_VERSION,
  dhashFromGray9x8,
  fingerprintKey,
  fingerprintOffsetsFor,
  type VideoFingerprint,
} from "@scoutable/shared/lib/video-fingerprint";
import { grabGray9x8, grabJpeg, grabRange, jpegSize, type Probe } from "./ffmpeg";

/** Whole frames are read at this width; the model needs no more to see the court. */
export const WHOLE_WIDTH = 640;
const JPEG_QUALITY = 4;
const PERIOD_LENGTH_S = 600;

/** Error tokens from the function that mean "stop quietly" rather than "something broke". */
export const SILENT_DETECT_ERRORS: ReadonlySet<string> = new Set(["detection_disabled", "too_many_requests"]);
/** Tokens worth one retry with smaller batches. */
export const RETRYABLE_DETECT_ERRORS: ReadonlySet<string> = new Set(["too_many_frames", "payload_too_large", "model_truncated", "model_error", "parse_failed"]);
/** A batch this small isn't split any further. */
const MIN_SPLIT_FRAMES = 8;

/** A `tipoff-detect` error token, carried as the message. */
export class DetectError extends Error {
  constructor(public token: string) {
    super(token);
    this.name = "DetectError";
  }
}

/** Scoreboard crops read at native resolution (2× for < 720p sources), whole frames at 640 px. */
export function outputWidth(srcWidth: number, crop?: OverlayBox | null): number {
  if (!crop) return WHOLE_WIDTH;
  if (srcWidth >= 1280) return WHOLE_WIDTH;
  return Math.max(64, Math.min(1920, Math.round(srcWidth * crop.w * 2)));
}

/** `fn` over `items`, at most `concurrency` at a time, results in input order. */
export async function parallel<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** The recording's content fingerprint (lib/video-fingerprint.ts) from 9×8 grey thumbnails at the fixed offsets. */
export async function fingerprint(source: string, p: Probe): Promise<VideoFingerprint> {
  const offsetsS = fingerprintOffsetsFor(p.durationS);
  const hashes = await parallel(offsetsS, async (t) => dhashFromGray9x8(await grabGray9x8(source, t)));
  return { version: FINGERPRINT_VERSION, durationMs: p.durationMs, offsetsS, hashes, key: await fingerprintKey(p.durationMs, hashes) };
}

/** One call to the function's read_frames, however it is made. */
export type FrameReader = (frames: Frame[], view: FrameView) => Promise<TipoffDetectResult<ReadFramesResponse>>;

/**
 * Read a batch of frames; when the function balks at the batch itself (too
 * many frames, a truncated or unparsable answer) split it in two and read
 * each half once more, re-indexing the second half. Anything else is thrown
 * as a DetectError with the function's token.
 */
export async function readWithRetry(read: FrameReader, frames: Frame[], view: FrameView, retried = false): Promise<FrameReading[]> {
  const res = await read(frames, view);
  if (res.ok) return res.data.readings;
  if (!retried && RETRYABLE_DETECT_ERRORS.has(res.error) && frames.length > MIN_SPLIT_FRAMES) {
    const half = Math.ceil(frames.length / 2);
    const [a, b] = await Promise.all([readWithRetry(read, frames.slice(0, half), view, true), readWithRetry(read, frames.slice(half), view, true)]);
    return [...a, ...b.map((r) => ({ ...r, index: r.index + half }))];
  }
  throw new DetectError(res.error);
}

/**
 * `runTipoffDetection`'s dependencies for a local file (or any URL ffmpeg
 * can read): frames through ffmpeg, readings through the function with the
 * given signed-in client.
 */
export function detectDeps(supabase: SupabaseClient, source: string, p: Probe, log?: (s: string) => void): DetectDeps {
  const toFrame = (t: number, jpeg: Buffer): Frame => ({ t, jpegBase64: jpeg.toString("base64"), ...jpegSize(jpeg) });
  const reader: FrameReader = (frames, view) =>
    readFrames(supabase, { frames: frames.map((f) => ({ jpegBase64: f.jpegBase64 })), view, periodLengthS: PERIOD_LENGTH_S });
  return {
    grab: (times, o) => parallel(times, async (t) => toFrame(t, await grabJpeg(source, t, { width: outputWidth(p.width, o.crop), crop: o.crop, quality: JPEG_QUALITY }))),
    grabRange: async (startS, durationS, fps, o) =>
      (await grabRange(source, startS, durationS, fps, { width: outputWidth(p.width, o.crop), crop: o.crop, quality: JPEG_QUALITY })).map((f) => toFrame(f.t, f.jpeg)),
    read: (frames, view) => readWithRetry(reader, frames, view),
    locate: async (frames) => {
      const res = await locateOverlay(supabase, { frames: frames.map((f) => ({ jpegBase64: f.jpegBase64 })) });
      if (!res.ok) {
        // A kill switch or a rate limit means the whole run should stop, not fall back to whole frames.
        if (SILENT_DETECT_ERRORS.has(res.error)) throw new DetectError(res.error);
        return null;
      }
      return res.data.found && res.data.box ? { box: res.data.box, confidence: res.data.confidence } : null;
    },
    log,
  };
}
