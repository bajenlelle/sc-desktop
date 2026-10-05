/**
 * Frames from the user's own video files through the Rust sidecar commands
 * (`probe_video`, `grab_frames`). Used by the recording fingerprint and the
 * tip-off detector; nothing here touches the network.
 */
import { invoke } from "@tauri-apps/api/core";

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
}

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FrameAt = { kind: "times"; times: number[] } | { kind: "range"; start: number; duration: number; fps: number };

export type FrameOutput =
  | { kind: "jpeg"; width: number; quality: number; crop?: CropBox | null }
  | { kind: "gray_thumb"; width: number; height: number };

export interface GrabbedFrame {
  t: number;
  dataBase64: string;
  width: number;
  height: number;
}

export function probeVideo(path: string): Promise<VideoProbe> {
  return invoke<VideoProbe>("probe_video", { path });
}

export function grabFrames(path: string, at: FrameAt, output: FrameOutput): Promise<GrabbedFrame[]> {
  return invoke<GrabbedFrame[]>("grab_frames", { req: { path, at, output } });
}

/** Seeks are independent, so split the times over a few sidecar processes. */
export async function grabFramesParallel(path: string, times: number[], output: FrameOutput, concurrency = 4): Promise<GrabbedFrame[]> {
  if (times.length === 0) return [];
  const buckets: number[][] = Array.from({ length: Math.min(concurrency, times.length) }, () => []);
  times.forEach((t, i) => buckets[i % buckets.length].push(t));
  const parts = await Promise.all(buckets.map((b) => grabFrames(path, { kind: "times", times: b }, output)));
  return parts.flat().sort((a, b) => a.t - b.t);
}

/** Base64 (as returned by the sidecar) → bytes, for hashing. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
