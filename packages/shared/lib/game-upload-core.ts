/**
 * The browser upload of a game's original, the parts that need no browser:
 * the byte sample that identifies a file so an interrupted upload resumes
 * only for the same one, the speed meter behind "Uploading · 1.2 of 3.4 GB",
 * the copy for every state a cloud game can be in, and the small schedulers
 * the upload loop runs on. The web's lib/game-upload.ts does the XHRs.
 */
import type { GameVideo } from "./game-videos-db";

// ---------------------------------------------------------------------------
// The resume key
// ---------------------------------------------------------------------------

/** Each sampled range is this long: three of them read in well under a second from any disk. */
export const RESUME_SAMPLE_BYTES = 64 * 1024;
/** The key's version prefix; the function matches it on the row's source fingerprint. */
export const RESUME_KEY_PREFIX = "wb1:";

export interface ByteRange {
  offset: number;
  length: number;
}

/**
 * The byte ranges to sample for a file of `size` bytes: its first, middle
 * and last RESUME_SAMPLE_BYTES, in order and never overlapping. A file
 * smaller than three samples is read whole. Throws `invalid_size`.
 */
export function sampleRanges(size: number, sample: number = RESUME_SAMPLE_BYTES): ByteRange[] {
  if (!Number.isInteger(size) || size <= 0) throw new Error("invalid_size");
  if (size <= sample * 3) return [{ offset: 0, length: size }];
  const middle = Math.floor((size - sample) / 2);
  return [
    { offset: 0, length: sample },
    { offset: middle, length: sample },
    { offset: size - sample, length: sample },
  ];
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The resume key for a file: `wb1:` + SHA-256 over its size and the sampled
 * bytes (sampleRanges, in order). The same file gives the same key on every
 * device; a different file of the same size almost never does. The size is
 * part of the hash so a truncated copy can't resume a longer one's upload.
 */
export async function resumeKey(size: number, samples: readonly Uint8Array[]): Promise<string> {
  const header = new TextEncoder().encode(`${size}|`);
  const total = header.length + samples.reduce((n, s) => n + s.length, 0);
  const all = new Uint8Array(total);
  all.set(header, 0);
  let at = header.length;
  for (const s of samples) {
    all.set(s, at);
    at += s.length;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", all);
  return RESUME_KEY_PREFIX + toHex(digest);
}

// ---------------------------------------------------------------------------
// The speed meter
// ---------------------------------------------------------------------------

/** The meter forgets a burst over about this long: steady enough to read, quick enough to follow a stall. */
export const UPLOAD_METER_WINDOW_MS = 10_000;

/**
 * Bytes per second as an exponential moving average over the last ten
 * seconds, fed with the running total of bytes done. The first sample sets
 * the clock; the speed is known from the second. A stall (progress events
 * stop) is pushed in by `stall()` so the estimate falls instead of freezing.
 */
export class UploadMeter {
  private lastAt: number | null = null;
  private lastDone = 0;
  private ema: number | null = null;

  constructor(private readonly windowMs: number = UPLOAD_METER_WINDOW_MS) {}

  /** Records that `doneBytes` of the whole upload are on the server (or in flight and acknowledged) at `now`. */
  record(doneBytes: number, now: number): void {
    if (this.lastAt === null) {
      this.lastAt = now;
      this.lastDone = doneBytes;
      return;
    }
    const dt = now - this.lastAt;
    if (dt <= 0) return;
    const instant = (Math.max(0, doneBytes - this.lastDone) / dt) * 1000;
    this.blend(instant, dt);
    this.lastAt = now;
    this.lastDone = doneBytes;
  }

  /** Nothing has arrived since the last record: counts the silence as zero throughput. */
  stall(now: number): void {
    if (this.lastAt === null) return;
    const dt = now - this.lastAt;
    if (dt <= 0) return;
    this.blend(0, dt);
    this.lastAt = now;
  }

  private blend(instant: number, dt: number) {
    const alpha = 1 - Math.exp(-dt / this.windowMs);
    this.ema = this.ema === null ? instant : this.ema + alpha * (instant - this.ema);
  }

  /** Bytes per second, or null before the meter has two samples. */
  get speedBps(): number | null {
    return this.ema;
  }

  /** Seconds left for `remainingBytes` at the current speed; null while unknown or stalled. */
  etaSeconds(remainingBytes: number): number | null {
    if (this.ema === null || this.ema < 1) return null;
    return Math.max(0, remainingBytes) / this.ema;
  }
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** "850 MB", "3.4 GB": a file size as the upload card shows it. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 MB";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** "1.2 of 3.4 GB": progress in the larger unit, so the two numbers compare. */
export function formatProgressBytes(doneBytes: number, totalBytes: number): string {
  if (totalBytes >= 1e9) return `${(doneBytes / 1e9).toFixed(1)} of ${(totalBytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(doneBytes / 1e6)} of ${Math.max(1, Math.round(totalBytes / 1e6))} MB`;
}

/** "About a minute left", "About 4 min left", "About 2 h left". */
export function formatEta(seconds: number): string {
  if (seconds < 90) return "About a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} min left`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "About an hour left" : `About ${hours} h left`;
}

/** "12 MB/s", "850 kB/s". */
export function formatSpeed(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 10e6 ? 0 : 1)} MB/s`;
  return `${Math.max(1, Math.round(bps / 1e3))} kB/s`;
}

/** A typical home uplink, for the estimate shown before the upload starts. */
export const ASSUMED_UPLOAD_BPS = 2.5e6;

/**
 * "About 20 min" for a file of `bytes` at an assumed speed, before anything
 * is known about the connection. Quoted as a rough figure on purpose.
 */
export function estimatedUploadLabel(bytes: number, bps: number = ASSUMED_UPLOAD_BPS): string {
  const minutes = Math.max(1, Math.round(bytes / bps / 60));
  if (minutes < 60) return minutes === 1 ? "About a minute" : `About ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "About an hour" : `About ${hours} h`;
}

export type GameUploadPhase = "checking" | "uploading" | "finishing";

/** What a running upload job shows; the web's store holds one per game. */
export interface GameUploadProgress {
  phase: GameUploadPhase;
  doneBytes: number;
  totalBytes: number;
  speedBps: number | null;
  etaSeconds: number | null;
}

/** The job's one-line label: "Uploading · 1.2 of 3.4 GB". */
export function uploadLabel(job: GameUploadProgress): string {
  switch (job.phase) {
    case "checking":
      return "Checking the file";
    case "uploading":
      return `Uploading · ${formatProgressBytes(job.doneBytes, job.totalBytes)}`;
    case "finishing":
      return "Finishing the upload";
  }
}

/** The line under the label: speed and time left, once known. */
export function uploadDetail(job: GameUploadProgress): string | null {
  if (job.phase !== "uploading" || job.speedBps === null) return null;
  const parts = [formatSpeed(job.speedBps)];
  if (job.etaSeconds !== null) parts.push(formatEta(job.etaSeconds));
  return parts.join(" · ");
}

/** The function's and the upload loop's error tokens, as the user reads them. */
export function describeUploadError(token: string): string {
  switch (token) {
    case "limit_reached":
      return "No cloud games left on your plan.";
    case "feature_disabled":
      return "Cloud games are turned off right now.";
    case "unavailable":
      return "Cloud games aren't available right now. Try again later.";
    case "converter_unavailable":
      return "Uploading from the browser isn't available right now. Try again later.";
    case "not_owner":
      return "Only the person who imported the game can upload its video.";
    case "unsupported_type":
      return "Choose an MP4, MOV, MKV or WebM file.";
    case "too_large":
      return "Files up to 8 GB can be uploaded.";
    case "size_mismatch":
      return "The upload didn't arrive whole. Try again.";
    case "storage_failed":
      return "The storage service didn't answer. Try again in a moment.";
    case "not_authenticated":
      return "You're signed out. Sign in and try again.";
    case "cors_etag":
      return "The storage service didn't confirm the upload. This is a setup problem on our side; let us know.";
    case "part_failed":
      return "The upload kept failing. Check your connection and try again.";
    case "network":
      return "The connection dropped. Check it and try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

/** Why a conversion failed, as the game page and the list say it. */
export function describeConvertError(token: string | null): string {
  switch (token) {
    case "too_long":
      return "This video is longer than four hours, so it can't be converted. Trim it to the game and upload again.";
    case "no_video_stream":
      return "This file has no video in it.";
    case "unsupported_type":
      return "This file couldn't be read as a video. Choose an MP4, MOV, MKV or WebM file.";
    case "source_unreadable":
      return "The uploaded file couldn't be read back.";
    case "transcode_incomplete":
      return "The conversion stopped before the end.";
    case "size_mismatch":
      return "The converted copy didn't arrive whole.";
    case "upload_failed":
      return "The converted copy couldn't be stored.";
    case "gave_up":
      return "The conversion failed three times.";
    case "converter_unavailable":
      return "The converter didn't pick this game up.";
    default:
      return "The conversion failed.";
  }
}

/** True when a failed conversion can simply be run again from the kept original. */
export function convertErrorIsRetryable(token: string | null): boolean {
  switch (token) {
    case "too_long":
    case "no_video_stream":
    case "unsupported_type":
      return false;
    default:
      return true;
  }
}

/** "the tip-off" or "the first basket": the moment a game's sync anchors on. */
export function anchorNoun(kind: GameVideo["anchorKind"]): string {
  return kind === "first_basket" ? "the first basket" : "the tip-off";
}

/**
 * The status a game's row shows in the list and on its card, or null when
 * the game is simply ready to watch. `job` is the live upload on this device;
 * `hasSync` says whether the match has a sync point (the plays can be placed).
 */
export function gameVideoStatusLabel(
  video: Pick<GameVideo, "status" | "convertProgress" | "convertError" | "syncStatus" | "anchorKind">,
  job: Pick<GameUploadProgress, "doneBytes" | "totalBytes"> | null,
  hasSync: boolean,
): string | null {
  switch (video.status) {
    case "uploading":
      return job ? `Uploading · ${formatProgressBytes(job.doneBytes, job.totalBytes)}` : "Upload didn't finish";
    case "converting":
      return video.convertProgress === null ? "Waiting to convert" : `Converting · ${Math.round(video.convertProgress * 100)}%`;
    case "failed":
      return "Conversion failed";
    case "ready":
      if (!hasSync) return video.anchorKind === "first_basket" ? "Set the first basket" : "Set the tip-off";
      if (video.syncStatus === "applied") return "Check the tip-off";
      return null;
  }
}

// ---------------------------------------------------------------------------
// Schedulers
// ---------------------------------------------------------------------------

export class StepTimeout extends Error {
  constructor(what: string) {
    super(`timeout: ${what}`);
  }
}

/** The promise, or a StepTimeout after `ms`: no single step may hang the job. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeout(what)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Runs `run` over `items` with at most `limit` in flight; rejects on the first failure. */
export async function inParallel<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  });
  await Promise.all(workers);
}

/** How long to wait before retrying a part: a second more each time. */
export function retryDelayMs(attempt: number): number {
  return 1000 * Math.max(1, attempt);
}
