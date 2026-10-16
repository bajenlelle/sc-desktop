/**
 * Runs the shared tip-off detection pipeline against a local video: frames
 * come from the ffmpeg sidecar, readings from the `tipoff-detect` edge
 * function. Only JPEG stills of the first minutes leave the machine.
 */
import {
  runTipoffDetection,
  type DetectDeps,
  type DetectProgress,
  type DetectResult,
  type Frame,
  type FrameReading,
  type FrameView,
  type OverlayBox,
} from "@scoutable/shared/lib/tipoff-detect";
import { locateOverlay, readFrames } from "@scoutable/shared/lib/tipoff-detect-client";
import { createClient } from "@/lib/supabase/client";
import { grabFrames, grabFramesParallel, type FrameOutput, type GrabbedFrame, type VideoProbe } from "./video-frames";

/** Error tokens from the function that mean "stop quietly" rather than "something broke". */
export const SILENT_DETECT_ERRORS = new Set(["detection_disabled", "too_many_requests"]);
/** Tokens worth one retry with smaller batches. */
const RETRYABLE = new Set(["too_many_frames", "payload_too_large", "model_truncated", "model_error", "parse_failed"]);

export class DetectError extends Error {
  constructor(public token: string) {
    super(token);
    this.name = "DetectError";
  }
}

const WHOLE_WIDTH = 640;
const JPEG_QUALITY = 4;

function outputFor(probe: VideoProbe, view: FrameView, crop?: OverlayBox | null): FrameOutput {
  if (view === "overlay" && crop) {
    // Native resolution for the scoreboard digits; small sources get 2× so the clock stays legible.
    const width = probe.width >= 1280 ? WHOLE_WIDTH : Math.min(1920, Math.round(probe.width * crop.w * 2));
    return { kind: "jpeg", width: Math.max(64, width), quality: JPEG_QUALITY, crop };
  }
  return { kind: "jpeg", width: WHOLE_WIDTH, quality: JPEG_QUALITY };
}

const toFrame = (g: GrabbedFrame): Frame => ({ t: g.t, jpegBase64: g.dataBase64, width: g.width, height: g.height });

async function readWithRetry(frames: Frame[], view: FrameView, retried = false): Promise<FrameReading[]> {
  const res = await readFrames(createClient(), { frames: frames.map((f) => ({ jpegBase64: f.jpegBase64 })), view, periodLengthS: 600 });
  if (res.ok) return res.data.readings;
  if (!retried && RETRYABLE.has(res.error) && frames.length > 8) {
    const half = Math.ceil(frames.length / 2);
    const [a, b] = await Promise.all([readWithRetry(frames.slice(0, half), view, true), readWithRetry(frames.slice(half), view, true)]);
    return [...a, ...b.map((r) => ({ ...r, index: r.index + half }))];
  }
  throw new DetectError(res.error);
}

export interface DetectTipoffOptions {
  signal?: AbortSignal;
  onProgress?: (p: DetectProgress) => void;
  log?: (line: string) => void;
}

export function detectTipoff(path: string, probe: VideoProbe, opts: DetectTipoffOptions = {}): Promise<DetectResult> {
  const deps: DetectDeps = {
    grab: async (times, o) => (await grabFramesParallel(path, times, outputFor(probe, o.view, o.crop))).map(toFrame),
    grabRange: async (startS, durationS, fps, o) =>
      (await grabFrames(path, { kind: "range", start: startS, duration: durationS, fps }, outputFor(probe, o.view, o.crop))).map(toFrame),
    read: (frames, view) => readWithRetry(frames, view),
    locate: async (frames) => {
      const res = await locateOverlay(createClient(), { frames: frames.map((f) => ({ jpegBase64: f.jpegBase64 })) });
      if (!res.ok) {
        if (SILENT_DETECT_ERRORS.has(res.error)) throw new DetectError(res.error);
        return null;
      }
      return res.data.found && res.data.box ? { box: res.data.box, confidence: res.data.confidence } : null;
    },
    onProgress: opts.onProgress,
    signal: opts.signal,
    log: opts.log,
  };
  return runTipoffDetection(probe.durationMs / 1000, deps);
}
