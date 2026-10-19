/**
 * The server export's ffmpeg argument lists: the desktop's export_playlist
 * builders (apps/desktop/src-tauri/src/lib.rs `build_crop_x_expr`,
 * `clip_segment_args`, `text_card_args`, `concat_args`, `extract_poster_frame`)
 * ported to TypeScript, with lib.rs's golden strings pinned in
 * __tests__/export-args.test.ts. Kept identical by hand: change both together.
 *
 * What the server adds to the desktop's lists, and why:
 * - `-hide_banner -loglevel error` right after `-y` on every list, so the
 *   container's stderr carries errors only (its log keeps the last line);
 * - an https input (a presigned GET of a cloud copy) gets ffmpeg's reconnect
 *   flags before its `-i`, as shipClipArgs (game-video-convert.ts) does;
 * - a clip whose copy has no audio stream gets the cards' silent stereo track
 *   (`anullsrc`, as long as the clip) mapped as its audio, since the concat
 *   filter needs audio on every input;
 * - only the final concat pass: `-pix_fmt yuv420p -movflags +faststart` for
 *   web playback, placed before `-r` so the list still ends `-r <rate> <out>`.
 *
 * Numbers are formatted as Rust's `{:.N}` formats them (rustFixed).
 * No runtime imports: the converter's container runs this from source.
 */
import type { ExportAspect } from "./game-video-wire";

/** A 9:16 pan keyframe as the export takes it: seconds from the clip's start, window centre 0..1 of the copy's width. */
export interface ExportKeyframe {
  t: number;
  cx: number;
}

/** The silent stereo track of a card (and of a clip whose copy has no audio). */
export const EXPORT_SILENCE = "anullsrc=channel_layout=stereo:sample_rate=44100";

/** Where a share's poster frame is taken: past the 0.25 s fade-in, then the first frame for a shorter video. */
export const POSTER_SEEKS = [0.6, 0] as const;

/** ffmpeg's reconnect flags for an input read over HTTP (the copies' presigned GETs). */
const RECONNECT = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"];
const QUIET = ["-hide_banner", "-loglevel", "error"];

const isHttp = (input: string) => /^https?:\/\//i.test(input);

/**
 * Rust's `format!("{:.N}", x)`. toFixed rounds the same exact value the same
 * way except on an exact binary tie (0.0625 to three places), which toFixed
 * rounds away from zero and Rust to the even digit; Rust also keeps the sign
 * of negative zero.
 */
export function rustFixed(x: number, digits: number): string {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x.toFixed(digits);
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  const magnitude = Math.abs(x);
  let out = magnitude.toFixed(digits);
  // Every double from 2^-48 (about 3.6e-15) up has its whole decimal expansion in 100 places;
  // a tie at ten places or fewer is far larger than that.
  const exact = magnitude.toFixed(100);
  const point = exact.indexOf(".");
  if (/^50*$/.test(exact.slice(point + 1 + digits))) {
    const kept = exact.slice(0, digits === 0 ? point : point + 1 + digits);
    if (Number(kept[kept.length - 1]) % 2 === 0) out = kept;
  }
  return sign + out;
}

const f3 = (x: number) => rustFixed(x, 3);
const f4 = (x: number) => rustFixed(x, 4);

/**
 * The crop filter's x for a moving 9:16 window (lib.rs `build_crop_x_expr`):
 * keyframes sorted by time, a keyframe within 1 ms of the one kept before it
 * dropped (the first stays), then a lerp chain over t for the window centre,
 * held at the last value, turned into an even left edge clamped inside the frame.
 */
export function cropXExpr(keyframes: readonly ExportKeyframe[]): string {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  const kfs: ExportKeyframe[] = [];
  for (const k of sorted) {
    const prev = kfs[kfs.length - 1];
    if (prev && Math.abs(k.t - prev.t) < 0.001) continue;
    kfs.push(k);
  }
  let chain: string;
  if (kfs.length === 0) chain = "0.5";
  else if (kfs.length === 1) chain = f4(kfs[0].cx);
  else {
    chain = f4(kfs[kfs.length - 1].cx);
    for (let i = kfs.length - 1; i >= 1; i--) {
      const a = kfs[i - 1];
      const b = kfs[i];
      chain = `if(lt(t\\,${f3(b.t)})\\,lerp(${f4(a.cx)}\\,${f4(b.cx)}\\,(t-${f3(a.t)})/${f3(b.t - a.t)})\\,${chain})`;
    }
  }
  return `2*trunc(clip(${chain}*iw-ow/2\\,0\\,iw-ow)/2)`;
}

export interface ClipSegmentArgsOptions {
  /** The copy: a presigned https URL in the container, a path in a dry run. */
  input: string;
  /** The window in the copy's timeline, seconds. */
  start: number;
  end: number;
  aspect: ExportAspect;
  /** exportFrameRate of the export (ffmpeg rate syntax). */
  rate: string;
  /** 9:16 only: the pan, rebased to the clip; null or empty centres the window. Ignored for 16:9. */
  keyframes?: readonly ExportKeyframe[] | null;
  /** False when the copy has no audio stream: the segment gets silence instead. */
  hasAudio: boolean;
  output: string;
}

/**
 * One clip as a segment (lib.rs `clip_segment_args`): the window re-timed
 * to start at 0 at the export's rate, letterboxed into 1280×720 (16:9) or a
 * 9:16 window cropped at the copy's resolution and scaled to 1080×1920 in
 * yuv420p, quarter-second fades, libx264 fast CRF 23, AAC 128k.
 */
export function clipSegmentArgs(o: ClipSegmentArgsOptions): string[] {
  const duration = Math.max(o.end - o.start, 0.001);
  const fadeOutStart = Math.max(duration - 0.25, 0);
  const fades = `fade=t=in:st=0:d=0.25,fade=t=out:st=${f3(fadeOutStart)}:d=0.25`;
  const vertical = o.aspect === "9:16";
  const vf = vertical
    ? `setpts=PTS-STARTPTS,fps=${o.rate},crop=w=min(iw\\,2*trunc(ih*9/32)):h=ih:x=${cropXExpr(o.keyframes ?? [])}:y=0,scale=1080:1920:flags=lanczos,setsar=1,${fades}`
    : `setpts=PTS-STARTPTS,fps=${o.rate},scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,${fades}`;
  const args = ["-y", ...QUIET];
  if (isHttp(o.input)) args.push(...RECONNECT);
  args.push("-ss", f3(o.start), "-to", f3(o.end), "-i", o.input);
  if (!o.hasAudio) args.push("-f", "lavfi", "-t", f3(duration), "-i", EXPORT_SILENCE, "-map", "0:v:0", "-map", "1:a:0");
  args.push("-vf", vf, "-af", "asetpts=PTS-STARTPTS", "-c:v", "libx264", "-preset", "fast", "-crf", "23");
  if (vertical) args.push("-pix_fmt", "yuv420p");
  args.push("-c:a", "aac", "-b:a", "128k", o.output);
  return args;
}

export interface CardSegmentArgsOptions {
  /** The card drawn at the export's size (card-paint.ts in packages/node-video). */
  png: string;
  durationSeconds: number;
  rate: string;
  output: string;
}

/** A drawn card as a segment with silent audio (lib.rs `text_card_args`). */
export function cardSegmentArgs(o: CardSegmentArgsOptions): string[] {
  const fadeOutStart = Math.max(o.durationSeconds - 0.25, 0);
  return [
    "-y",
    ...QUIET,
    "-framerate", o.rate,
    "-loop", "1",
    "-i", o.png,
    "-f", "lavfi",
    "-i", EXPORT_SILENCE,
    "-vf", `fade=t=in:st=0:d=0.25,fade=t=out:st=${f3(fadeOutStart)}:d=0.25`,
    "-af", "asetpts=PTS-STARTPTS",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-t", f3(o.durationSeconds),
    o.output,
  ];
}

export interface ConcatArgsOptions {
  /** The segments, in order. */
  inputs: readonly string[];
  /** The wordmark PNG to overlay on the whole timeline; null leaves it off. */
  watermarkPng: string | null;
  aspect: ExportAspect;
  rate: string;
  output: string;
}

/**
 * The final pass (lib.rs `concat_args`): the concat filter over every
 * segment, the wordmark overlaid after it (16:9 bottom right; 9:16 centred,
 * lifted 700 px above the bottom, clear of TikTok's and Reels' controls),
 * one constant output rate.
 */
export function concatArgs(o: ConcatArgsOptions): string[] {
  const n = o.inputs.length;
  const args = ["-y", ...QUIET];
  for (const input of o.inputs) args.push("-i", input);
  if (o.watermarkPng != null) args.push("-i", o.watermarkPng);
  let filter = o.inputs.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("");
  if (o.watermarkPng != null) {
    const position = o.aspect === "9:16" ? "(W-w)/2:H-h-700" : "W-w-24:H-h-48";
    filter += `concat=n=${n}:v=1:a=1[cv][outa];[cv][${n}:v]overlay=${position}[outv]`;
  } else {
    filter += `concat=n=${n}:v=1:a=1[outv][outa]`;
  }
  args.push(
    "-filter_complex", filter,
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-r", o.rate,
    o.output,
  );
  return args;
}

/** A share's poster frame as a JPEG (lib.rs `extract_poster_frame`; try POSTER_SEEKS in order). */
export function posterArgs(input: string, output: string, atSeconds: number): string[] {
  return ["-y", ...QUIET, "-ss", String(atSeconds), "-i", input, "-frames:v", "1", "-q:v", "3", output];
}
