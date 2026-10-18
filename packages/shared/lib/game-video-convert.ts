/**
 * The converter's pure parts: the ffmpeg arguments for a 720p copy, ffmpeg's
 * progress lines, the rule that turns a detection into a sync status, the
 * checks on a probed original, and the job's progress scale.
 *
 * The desktop encodes with the same arguments from Rust
 * (apps/desktop/src-tauri/src/game_video.rs::transcode_args); the two lists
 * are kept identical by hand, so a copy looks the same whoever made it.
 * `syncStatusFor` mirrors `_game_video_finish_convert` in the database:
 * change both together. No runtime imports: the function imports this file.
 */
import {
  GAME_VIDEO_MAX_SOURCE_SECONDS,
  GAME_VIDEO_SYNC_APPLY_CONFIDENCE,
  type GameVideoConvertError,
  type GameVideoSyncOutcome,
  type GameVideoSyncStatus,
} from "./game-video-wire";

/**
 * The whole file, 720p at most (never upscaled), libx264 veryfast, a
 * keyframe every two seconds so seeks over the network land quickly, AAC
 * stereo, faststart so the browser can start before the file has
 * downloaded, and ffmpeg's progress on stdout.
 */
export function transcodeArgs(input: string, output: string, scaleDown: boolean): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", input, "-map", "0:v:0", "-map", "0:a:0?"];
  if (scaleDown) args.push("-vf", "scale=-2:720");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-maxrate",
    "3500k",
    "-bufsize",
    "7000k",
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    "expr:gte(t,n_forced*2)",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    output,
  );
  return args;
}

/**
 * Microseconds encoded so far, from one line of `-progress` output. ffmpeg
 * prints `out_time_us=…` and, in older builds, `out_time_ms=…`, which is
 * microseconds too despite the name. `N/A` and other lines give null.
 */
export function parseProgressUs(line: string): number | null {
  const i = line.indexOf("=");
  if (i < 0) return null;
  const key = line.slice(0, i).trim();
  if (key !== "out_time_us" && key !== "out_time_ms") return null;
  const value = line.slice(i + 1).trim();
  if (!/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 0 && Number.isFinite(n) ? n : null;
}

/**
 * What a detection outcome becomes on the row. A confirmed hint and a
 * confident estimate are applied; a weaker estimate is kept as a suggestion.
 */
export function syncStatusFor(outcome: GameVideoSyncOutcome, confidence: number | null | undefined): GameVideoSyncStatus {
  switch (outcome) {
    case "confirmed":
      return "applied";
    case "estimate":
      return typeof confidence === "number" && confidence >= GAME_VIDEO_SYNC_APPLY_CONFIDENCE ? "applied" : "suggested";
    case "not_found":
      return "not_found";
    case "skipped":
      return "skipped";
  }
}

export interface ProbedSource {
  /** Null when ffmpeg could not read the file at all. */
  durationS: number | null;
  width: number;
  height: number;
  hasVideo: boolean;
}

/** Why a probed original can't be converted, or null when it can. Every reason here is final: a retry would fail the same way. */
export function sourceRefusal(probe: ProbedSource | null): GameVideoConvertError | null {
  if (!probe || probe.durationS === null || !Number.isFinite(probe.durationS) || probe.durationS <= 0) return "unsupported_type";
  if (!probe.hasVideo || probe.width <= 0 || probe.height <= 0) return "no_video_stream";
  if (probe.durationS > GAME_VIDEO_MAX_SOURCE_SECONDS) return "too_long";
  return null;
}

/** Whether a conversion failure is worth another attempt. */
export function isRetryableConvertError(error: GameVideoConvertError | string): boolean {
  switch (error) {
    case "too_long":
    case "no_video_stream":
    case "unsupported_type":
    case "converter_unavailable":
      return false;
    default:
      return true;
  }
}

export type ConvertPhase = "download" | "encode" | "upload" | "detect";

/** Where each phase sits on the job's single 0..1 progress bar. */
const PHASE_SPAN: Record<ConvertPhase, [number, number]> = {
  download: [0, 0.05],
  encode: [0.05, 0.75],
  upload: [0.75, 0.95],
  detect: [0.95, 1],
};

/** The job's overall progress when `fraction` (0..1) of `phase` is done. */
export function progressFraction(phase: ConvertPhase, fraction: number): number {
  const [from, to] = PHASE_SPAN[phase];
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return Math.round((from + (to - from) * f) * 1000) / 1000;
}

/** True when a copy's probed duration matches its original's closely enough to be whole. */
export function copyLooksWhole(sourceDurationS: number, copyDurationS: number | null, toleranceS = 2): boolean {
  return copyDurationS !== null && Number.isFinite(copyDurationS) && Math.abs(copyDurationS - sourceDurationS) <= toleranceS;
}

// ---------------------------------------------------------------------------
// Shipping a clip (the desktop's Clip & Ship cut, run on the server from the cloud copy)
// ---------------------------------------------------------------------------

/** A cut shorter than this many bytes is an ffmpeg failure in disguise, as the desktop treats it. */
export const SHIP_MIN_OUTPUT_BYTES = 4096;

/**
 * The desktop's clip cut (apps/desktop/src-tauri/src/lib.rs `export_clip_for_ship`),
 * kept identical by hand: the window in seconds, 960×540 letterboxed, quarter-second
 * fades, libx264 fast at CRF 28, AAC 96k, always re-encoded. An https input gets
 * ffmpeg's reconnect flags, since the server cuts straight from a presigned URL of
 * the copy (`-ss` before `-i` seeks the input; the copy's 2 s keyframes keep it cheap).
 */
export function shipClipArgs(input: string, start: number, end: number, output: string): string[] {
  const duration = Math.max(0, end - start);
  const fadeOutAt = Math.max(duration - 0.25, 0);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (/^https?:\/\//i.test(input)) args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
  args.push(
    "-ss",
    start.toFixed(3),
    "-to",
    end.toFixed(3),
    "-i",
    input,
    "-vf",
    `setpts=PTS-STARTPTS,scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutAt.toFixed(3)}:d=0.25`,
    "-af",
    "asetpts=PTS-STARTPTS",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    output,
  );
  return args;
}
