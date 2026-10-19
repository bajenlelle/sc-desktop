/**
 * Frame access through a local ffmpeg: the system one (apt on the runner and
 * in the converter image, Homebrew locally) or the path in the FFMPEG env
 * var, read once at load. The argv shapes match the desktop sidecar's
 * (src-tauri/src/video_frames.rs); `source` is a local path or a URL ffmpeg
 * can read, such as the nightly job's range proxy.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OverlayBox } from "@scoutable/shared/lib/tipoff-detect";

const run = promisify(execFile);
/** The ffmpeg binary every call here (and the converter's encode) uses. */
export const FFMPEG = process.env.FFMPEG?.trim() || "ffmpeg";
const MAX_BUFFER = 256 * 1024 * 1024;

export interface Probe {
  durationMs: number;
  durationS: number;
  width: number;
  height: number;
  fps: number;
}

/** Duration / size / fps from `ffmpeg -i` stderr (exit 1 is normal: no output file). */
export async function probe(source: string): Promise<Probe | null> {
  let stderr = "";
  try {
    await run(FFMPEG, ["-hide_banner", "-i", source], { maxBuffer: MAX_BUFFER });
  } catch (e) {
    stderr = (e as { stderr?: string }).stderr ?? "";
  }
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #\d+:\d+.*Video:.*?\s(\d{2,5})x(\d{2,5})[\s,].*?(\d+(?:\.\d+)?)\s*fps/.exec(stderr);
  if (!d) return null;
  const durationS = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  return { durationMs: Math.round(durationS * 1000), durationS, width: v ? Number(v[1]) : 0, height: v ? Number(v[2]) : 0, fps: v ? Number(v[3]) : 0 };
}

/** What the server export needs to know about a copy (or a rendered file) before it cuts from it. */
export interface StreamProbe {
  /** An audio stream is there (a clip from a copy without one gets silence, so the concat filter has audio on every input). */
  hasAudio: boolean;
  /** The first video stream's `fps` as ffmpeg prints it; 0 when it prints none or there is no video stream. */
  fps: number;
  /** Null when ffmpeg prints no duration (a live stream, `N/A`). */
  durationSeconds: number | null;
  /** The first video stream's size; 0 × 0 without one. */
  width: number;
  height: number;
}

/**
 * `ffmpeg -hide_banner -i <input>` stderr → the probe, read the way the
 * desktop's parse_ffmpeg_probe (src-tauri/src/video_frames.rs) reads it:
 * the `Duration:` line, then the first `Video:` stream line's `WxH` and
 * `N fps` tokens; plus whether any `Audio:` stream line is there. Null when
 * the stderr shows no input was opened (no `Input #` header).
 */
export function parseStreamProbe(stderr: string): StreamProbe | null {
  const lines = stderr.split(/\r?\n/);
  if (!lines.some((l) => /^Input #\d+,/.test(l.trim()))) return null;
  let durationSeconds: number | null = null;
  const durationLine = lines.find((l) => l.trim().startsWith("Duration:"));
  const d = durationLine ? /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(durationLine) : null;
  if (d) durationSeconds = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const isStream = (l: string, type: string) => new RegExp(`^Stream #\\d+:\\d+.*?: ${type}:`).test(l.trim());

  let width = 0;
  let height = 0;
  let fps = 0;
  const video = lines.find((l) => isStream(l, "Video"));
  if (video) {
    for (const raw of video.split(",")) {
      const token = raw.trim();
      if (width === 0) {
        const size = /^(\d+)x(\d+)/.exec(token);
        if (size && Number(size[1]) >= 16 && Number(size[2]) >= 16) {
          width = Number(size[1]);
          height = Number(size[2]);
        }
      }
      if (fps === 0) {
        const rate = /^(\d+(?:\.\d+)?)\s+fps$/.exec(token);
        if (rate) fps = Number(rate[1]);
      }
    }
  }
  return { hasAudio: lines.some((l) => isStream(l, "Audio")), fps, durationSeconds, width, height };
}

/** Why probeStreams could not read an input: ffmpeg would not start, or ffmpeg could not open the input. */
export class ProbeFailure extends Error {
  constructor(
    public reason: "ffmpeg_unavailable" | "unreadable",
    /** ffmpeg's stderr (empty when it never started), for classifying the failure. */
    public stderr: string,
    message: string,
  ) {
    super(message);
    this.name = "ProbeFailure";
  }
}

const PROBE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Streams, size, rate and duration of a local file or a URL ffmpeg can read
 * (a presigned GET of a copy: only the header is read, the copies are
 * faststart). Throws ProbeFailure when ffmpeg can't be started or can't open
 * the input; a stuck read is killed after two minutes, or when `signal`
 * aborts (then the AbortError is thrown as it is).
 */
export async function probeStreams(input: string, opts: { signal?: AbortSignal } = {}): Promise<StreamProbe> {
  let stderr = "";
  try {
    await run(FFMPEG, ["-hide_banner", "-i", input], { maxBuffer: MAX_BUFFER, timeout: PROBE_TIMEOUT_MS, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    const err = e as { code?: unknown; stderr?: string; message?: string };
    // A string code (ENOENT, EACCES) is the spawn failing; a number is ffmpeg's exit (1 without an output file is normal).
    if (typeof err.code === "string") throw new ProbeFailure("ffmpeg_unavailable", "", `ffmpeg could not start: ${err.message ?? err.code}`);
    stderr = err.stderr ?? "";
  }
  const parsed = parseStreamProbe(stderr);
  if (!parsed) throw new ProbeFailure("unreadable", stderr, `ffmpeg could not open the input: ${stderr.trim().split("\n").pop() ?? ""}`);
  return parsed;
}

function cropFilter(crop: OverlayBox | null | undefined): string[] {
  if (!crop) return [];
  const f = (n: number) => n.toFixed(4);
  return [`crop=iw*${f(crop.w)}:ih*${f(crop.h)}:iw*${f(crop.x)}:ih*${f(crop.y)}`];
}

export interface GrabOptions {
  width: number;
  crop?: OverlayBox | null;
  quality?: number;
}

/** One JPEG at time t (keyframe seek, then decode). */
export async function grabJpeg(source: string, t: number, o: GrabOptions): Promise<Buffer> {
  const vf = [...cropFilter(o.crop), `scale=${o.width}:-2`].join(",");
  const { stdout } = await run(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(3), "-i", source, "-frames:v", "1", "-vf", vf, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", String(o.quality ?? 4), "-"],
    { encoding: "buffer", maxBuffer: MAX_BUFFER },
  );
  return stdout;
}

/** Many JPEGs from one decode run; frame i is at start + i/fps. */
export async function grabRange(source: string, start: number, duration: number, fps: number, o: GrabOptions): Promise<{ t: number; jpeg: Buffer }[]> {
  const vf = [`fps=${fps}`, ...cropFilter(o.crop), `scale=${o.width}:-2`].join(",");
  const { stdout } = await run(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-ss", start.toFixed(3), "-t", duration.toFixed(3), "-i", source, "-vf", vf, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", String(o.quality ?? 4), "-"],
    { encoding: "buffer", maxBuffer: MAX_BUFFER },
  );
  return splitMjpeg(stdout).map((jpeg, i) => ({ t: start + i / fps, jpeg }));
}

/** Split a concatenated MJPEG stream on SOI markers (FF D8 FF). */
export function splitMjpeg(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let startIdx = -1;
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      if (startIdx >= 0) out.push(buf.subarray(startIdx, i));
      startIdx = i;
    }
  }
  if (startIdx >= 0) out.push(buf.subarray(startIdx));
  return out;
}

/** 9×8 grey thumbnail (72 bytes) at time t: the dHash input, area-scaled like the desktop. */
export async function grabGray9x8(source: string, t: number): Promise<Uint8Array> {
  const { stdout } = await run(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(3), "-i", source, "-frames:v", "1", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: MAX_BUFFER },
  );
  if (stdout.length !== 72) throw new Error(`fingerprint thumbnail: expected 72 bytes, got ${stdout.length} at t=${t}`);
  return new Uint8Array(stdout);
}

/** JPEG dimensions from the SOF marker. */
export function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { width: 0, height: 0 };
}
