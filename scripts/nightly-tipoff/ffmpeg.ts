/**
 * Frame access through the system ffmpeg (apt on the runner, Homebrew locally).
 * The argv shapes match the desktop sidecar's (src-tauri/src/video_frames.rs);
 * `source` is a local path or the range proxy's URL.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OverlayBox } from "@scoutable/shared/lib/tipoff-detect";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
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
