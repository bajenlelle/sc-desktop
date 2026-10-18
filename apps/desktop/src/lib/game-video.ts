/**
 * "Keep a copy in the cloud": a 720p copy of a game, made on this computer by
 * the bundled ffmpeg, uploaded in 32 MiB parts to the private bucket through
 * presigned URLs from the game-video function, and marked ready once the
 * server has checked its size. The web then plays the game.
 *
 * One job per game at a time. Progress lives in a small external store so
 * the game page, the import form and a toast follow the same job. A copy
 * and its upload survive a restart: the finished copy waits in the app's
 * cache (never the OS temp dir), the server remembers the parts that
 * arrived, and resumeCloudCopies() picks the upload up on sign-in. Cancel
 * stops ffmpeg or the part in flight through the export registry.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  abortGameVideo,
  beginGameVideo,
  completeGameVideo,
  removeGameVideo,
  signGameVideoParts,
} from "@scoutable/shared/lib/game-video-client";
import { missingParts, partRange, type GameVideoPart } from "@scoutable/shared/lib/game-video-wire";
import {
  gameVideoBlock,
  getGameVideoForMatch,
  getGameVideoQuota,
  listMyGameVideos,
} from "@scoutable/shared/lib/game-videos-db";
import { trackEvent } from "@/lib/analytics";
import { getMatch } from "@/lib/matches-db";
import { Sentry } from "@/lib/sentry";
import { isLocalPath } from "@/lib/stream";
import { createClient } from "@/lib/supabase/client";
import { computeVideoFingerprint } from "@/lib/video-fingerprint";
import type { StoredMatch } from "@/types/match";

export const WEB_APP_URL = "https://app.scoutable.se";
/** Fired on window when a game's copy changed (uploaded, removed, failed), with `{ matchId }`. */
export const GAME_VIDEO_CHANGED = "game-video-changed";

const DEFAULT_KEY = "scoutable_cloud_copy_default";
const META_PREFIX = "scoutable_cloud_copy:";
/** Parts signed per request; a URL lives an hour, far longer than 16 parts take. */
const SIGN_BATCH = 16;
const PARALLEL_PARTS = 3;
const PART_ATTEMPTS = 3;
/** Copies that waited this long never finished: R2 forgot their upload too. */
const CACHE_MAX_AGE_DAYS = 7;
/**
 * No single step may hang the job: a 32 MiB part on a slow uplink gets this
 * long, a function call this long. A webview that sat occluded behind other
 * windows was once seen to stop resolving its waits with Rust already idle;
 * a bounded wait turns that into a retry instead of a toast stuck for good.
 */
const PART_TIMEOUT_MS = 15 * 60_000;
const CALL_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// The job store
// ---------------------------------------------------------------------------

export type CloudCopyPhase = "checking" | "encoding" | "uploading" | "finishing";

export interface CloudCopyJob {
  matchId: string;
  phase: CloudCopyPhase;
  /** 0–1 within the phase. */
  fraction: number;
  /** Seconds the encode has left, once it can tell. */
  etaSeconds: number | null;
  doneBytes: number;
  totalBytes: number;
}

export type CloudCopyOutcome = "ready" | "cancelled" | "failed";

const jobs = new Map<string, CloudCopyJob>();
const listeners = new Set<() => void>();
const running = new Map<string, { abort: AbortController; jobId: string; partJobs: Set<string> }>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  for (const listener of listeners) listener();
}

function setJob(matchId: string, patch: Partial<CloudCopyJob>) {
  const prev = jobs.get(matchId) ?? {
    matchId,
    phase: "checking" as const,
    fraction: 0,
    etaSeconds: null,
    doneBytes: 0,
    totalBytes: 0,
  };
  jobs.set(matchId, { ...prev, ...patch });
  publish();
}

function clearJob(matchId: string) {
  jobs.delete(matchId);
  running.delete(matchId);
  publish();
}

/** The running job for a game, or null. */
export function useCloudCopyJob(matchId: string): CloudCopyJob | null {
  return useSyncExternalStore(
    subscribe,
    () => jobs.get(matchId) ?? null,
    () => null,
  );
}

function announce(matchId: string) {
  window.dispatchEvent(new CustomEvent(GAME_VIDEO_CHANGED, { detail: { matchId } }));
}

/** What a job's row or toast says. */
export function cloudCopyLabel(job: CloudCopyJob): string {
  switch (job.phase) {
    case "checking":
      return "Checking the video";
    case "encoding":
      return `Encoding the copy · ${Math.round(job.fraction * 100)}%`;
    case "uploading":
      return `Uploading · ${gb(job.doneBytes)} of ${gb(job.totalBytes)} GB`;
    case "finishing":
      return "Finishing the upload";
  }
}

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

function minutesLeft(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m === 1 ? "About a minute left" : `About ${m} min left`;
}

// ---------------------------------------------------------------------------
// Remembering things on this computer
// ---------------------------------------------------------------------------

/** The import form's "also keep a copy" switch, as last set. */
export function readCloudCopyDefault(): boolean {
  try {
    return localStorage.getItem(DEFAULT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCloudCopyDefault(on: boolean) {
  try {
    localStorage.setItem(DEFAULT_KEY, on ? "1" : "0");
  } catch {
    // A convenience.
  }
}

/** What the cached copy was made from, so a resume can trust it. */
interface CopyMeta {
  fingerprintKey: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
}

function readMeta(matchId: string): CopyMeta | null {
  try {
    const raw = localStorage.getItem(META_PREFIX + matchId);
    return raw ? (JSON.parse(raw) as CopyMeta) : null;
  } catch {
    return null;
  }
}

function writeMeta(matchId: string, meta: CopyMeta | null) {
  try {
    if (meta) localStorage.setItem(META_PREFIX + matchId, JSON.stringify(meta));
    else localStorage.removeItem(META_PREFIX + matchId);
  } catch {
    // Without it the next run encodes again, which is safe.
  }
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

interface FileInfo {
  sizeBytes: number;
  modifiedMs: number;
}

interface TranscodeResult {
  sizeBytes: number;
  width: number;
  height: number;
  durationMs: number;
}

const cachePath = (matchId: string) => invoke<string>("game_video_cache_path", { matchId });
const fileInfo = (path: string) => invoke<FileInfo | null>("game_video_file_info", { path });
const deleteCached = (path: string) => invoke<void>("game_video_delete_cached", { path }).catch(() => {});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type Stage = "check" | "encode" | "upload" | "complete";

class CloudCopyError extends Error {
  constructor(
    message: string,
    readonly stage: Stage,
    readonly token: string,
  ) {
    super(message);
  }
}

class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

function describe(token: string): string {
  switch (token) {
    case "limit_reached":
      return "No cloud games left on your plan.";
    case "feature_disabled":
      return "Cloud copies are turned off right now.";
    case "unavailable":
      return "Cloud copies aren't available right now. Try again later.";
    case "not_owner":
      return "Only the coach who imported the game can keep a copy of it.";
    case "too_large":
      return "The copy is too large to upload.";
    case "size_mismatch":
      return "The upload didn't arrive whole. Try again.";
    case "storage_failed":
      return "The storage service didn't answer. Try again in a moment.";
    case "not_authenticated":
      return "You're signed out. Sign in and try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Cancelled();
}

class StepTimeout extends Error {
  constructor(what: string) {
    super(`timeout: ${what}`);
  }
}

/** The promise, or a StepTimeout after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
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

async function inParallel<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/**
 * Makes and uploads the game's copy. Resolves when the server has it, the
 * user stopped it, or it failed (the toast has said why). A game already in
 * the cloud resolves "ready" at once unless `replace` is set.
 */
export async function startCloudCopy(match: StoredMatch, opts: { replace?: boolean } = {}): Promise<CloudCopyOutcome> {
  if (running.has(match.id)) return "failed";
  const source = match.videoUrl;
  if (!source || !isLocalPath(source)) {
    toast.error("Choose the game's video first", { description: "The copy is made from the video on this computer." });
    return "failed";
  }

  const supabase = createClient();
  const toastId = `game-video-${match.id}`;
  const abort = new AbortController();
  const jobId = `cloud-${match.id}-${Date.now().toString(36)}`;
  const ctrl = { abort, jobId, partJobs: new Set<string>() };
  running.set(match.id, ctrl);
  setJob(match.id, { phase: "checking", fraction: 0 });
  let lastToast = "";
  const say = (label: string, description?: string) => {
    const key = `${label}|${description ?? ""}`;
    if (key === lastToast) return;
    lastToast = key;
    toast.loading(label, { id: toastId, description, duration: Infinity });
  };

  const startedAt = Date.now();
  let stage: Stage = "check";
  let videoId: string | null = null;
  let copyPath: string | null = null;

  try {
    // The meter first: no encode for nothing, and none at all for a server
    // that doesn't know about copies yet.
    const quota = await withTimeout(getGameVideoQuota(supabase, match.orgId ?? null), CALL_TIMEOUT_MS, "quota");
    const block = gameVideoBlock(quota);
    if (block) {
      const token = block === "disabled" ? "feature_disabled" : block;
      throw new CloudCopyError(describe(token), "check", block);
    }
    say("Checking the video");

    // The source, and what the copy will be made from.
    const { probe, fingerprint } = await computeVideoFingerprint(source);
    throwIfAborted(abort.signal);
    trackEvent("game_video_upload_started", { match_id: match.id, duration_s: Math.round(probe.durationMs / 1000) });

    // The copy: made now, or still in the cache from an interrupted run.
    stage = "encode";
    copyPath = await cachePath(match.id);
    let meta = readMeta(match.id);
    let info = await fileInfo(copyPath);
    let encodeSeconds = 0;
    if (!info || !meta || meta.fingerprintKey !== fingerprint.key || meta.sizeBytes !== info.sizeBytes) {
      if (info) await deleteCached(copyPath);
      setJob(match.id, { phase: "encoding", fraction: 0, etaSeconds: null });
      say("Encoding the copy · 0%", "Keep Scoutable open while it works.");
      const encodeStart = Date.now();
      const unlisten = await listen<{ id: string; phase: string; fraction: number }>("game-video-progress", (event) => {
        if (event.payload.id !== jobId) return;
        const f = event.payload.fraction;
        const elapsed = (Date.now() - encodeStart) / 1000;
        const eta = f > 0.03 ? (elapsed * (1 - f)) / f : null;
        setJob(match.id, { phase: "encoding", fraction: f, etaSeconds: eta });
        say(`Encoding the copy · ${Math.round(f * 100)}%`, eta !== null ? `${minutesLeft(eta)}. Keep Scoutable open.` : "Keep Scoutable open while it works.");
      });
      let result: TranscodeResult;
      try {
        result = await invoke<TranscodeResult>("transcode_game_video", {
          input: source,
          output: copyPath,
          sourceDurationMs: probe.durationMs,
          sourceHeight: probe.height,
          jobId,
        });
      } catch (e) {
        if (String(e) === "export_cancelled") throw new Cancelled();
        throw new CloudCopyError("The copy couldn't be made. Try again.", "encode", "transcode_failed");
      } finally {
        unlisten();
      }
      encodeSeconds = (Date.now() - encodeStart) / 1000;
      info = { sizeBytes: result.sizeBytes, modifiedMs: Date.now() };
      meta = {
        fingerprintKey: fingerprint.key,
        sizeBytes: result.sizeBytes,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
      };
      writeMeta(match.id, meta);
    }
    throwIfAborted(abort.signal);

    // The upload: new, or resumed where it stopped.
    stage = "upload";
    const begun = await withTimeout(
      beginGameVideo(supabase, {
        matchId: match.id,
        sizeBytes: info.sizeBytes,
        durationSeconds: meta.durationMs / 1000,
        width: meta.width,
        height: meta.height,
        fingerprintKey: fingerprint.key,
        replace: opts.replace === true,
      }),
      CALL_TIMEOUT_MS,
      "begin",
    );
    if (!begun.ok) {
      if (begun.error === "already_ready") {
        // Nothing to do: the game is in the cloud already.
        await deleteCached(copyPath);
        writeMeta(match.id, null);
        toast.dismiss(toastId);
        return "ready";
      }
      throw new CloudCopyError(describe(begun.error), "upload", begun.error);
    }
    videoId = begun.data.videoId;
    const plan = { partSize: begun.data.partSize, count: begun.data.partCount };
    const etags = new Map<number, string>(begun.data.completedParts.map((p) => [p.partNumber, p.etag]));
    const missing = missingParts(plan.count, begun.data.completedParts);
    let doneBytes = 0;
    for (const n of etags.keys()) doneBytes += partRange(n, plan, info.sizeBytes).length;
    const totalBytes = info.sizeBytes;
    const uploadStart = Date.now();
    const report = () => {
      setJob(match.id, { phase: "uploading", fraction: totalBytes > 0 ? doneBytes / totalBytes : 0, doneBytes, totalBytes });
      say(`Uploading · ${gb(doneBytes)} of ${gb(totalBytes)} GB`, "You can keep working; the upload continues in the background.");
    };
    report();

    const signed = new Map<number, string>();
    const sign = async (numbers: number[]) => {
      const r = await withTimeout(signGameVideoParts(supabase, { videoId: videoId!, partNumbers: numbers }), CALL_TIMEOUT_MS, "sign_parts");
      if (!r.ok) throw new CloudCopyError(describe(r.error), "upload", r.error);
      for (const u of r.data.urls) signed.set(u.partNumber, u.url);
    };

    for (let i = 0; i < missing.length; i += SIGN_BATCH) {
      throwIfAborted(abort.signal);
      const batch = missing.slice(i, i + SIGN_BATCH);
      await sign(batch);
      await inParallel(batch, PARALLEL_PARTS, async (partNumber) => {
        const { offset, length } = partRange(partNumber, plan, totalBytes);
        for (let attempt = 1; ; attempt++) {
          throwIfAborted(abort.signal);
          const partJobId = `${jobId}:${partNumber}`;
          ctrl.partJobs.add(partJobId);
          try {
            const etag = await withTimeout(
              invoke<string>("game_video_upload_part", {
                path: copyPath,
                offset,
                length,
                url: signed.get(partNumber),
                jobId: partJobId,
              }),
              PART_TIMEOUT_MS,
              `part ${partNumber}`,
            );
            etags.set(partNumber, etag);
            doneBytes += length;
            report();
            return;
          } catch (e) {
            const message = String(e instanceof Error ? e.message : e);
            if (message === "export_cancelled" || abort.signal.aborted) throw new Cancelled();
            // A wait that ran out leaves nothing of the request behind.
            if (e instanceof StepTimeout) await invoke("cancel_export", { id: partJobId }).catch(() => {});
            if (attempt >= PART_ATTEMPTS) {
              throw new CloudCopyError("The upload kept failing. Check your connection and try again.", "upload", "part_failed");
            }
            // An expired URL answers 403: sign that part again before retrying.
            if (message.includes("upload_status_403")) await sign([partNumber]);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          } finally {
            ctrl.partJobs.delete(partJobId);
          }
        }
      });
    }

    stage = "complete";
    setJob(match.id, { phase: "finishing", fraction: 1 });
    say("Finishing the upload");
    const parts: GameVideoPart[] = [...etags.entries()]
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);
    const done = await withTimeout(completeGameVideo(supabase, { videoId, parts }), CALL_TIMEOUT_MS, "complete");
    if (!done.ok) throw new CloudCopyError(describe(done.error), "complete", done.error);

    await deleteCached(copyPath);
    writeMeta(match.id, null);
    trackEvent("game_video_uploaded", {
      match_id: match.id,
      copy_mb: Math.round(totalBytes / 1e6),
      encode_s: Math.round(encodeSeconds),
      upload_s: Math.round((Date.now() - uploadStart) / 1000),
      resumed: begun.data.resumed,
    });
    toast.success("Your game is on the web", {
      id: toastId,
      description: "Open Games on app.scoutable.se to watch it.",
      duration: 8000,
    });
    announce(match.id);
    return "ready";
  } catch (e) {
    if (e instanceof Cancelled || abort.signal.aborted) {
      // Stopped on purpose: nothing of it is kept, here or on the server.
      if (videoId) void abortGameVideo(supabase, { videoId }).catch(() => {});
      if (copyPath) await deleteCached(copyPath);
      writeMeta(match.id, null);
      toast.dismiss(toastId);
      announce(match.id);
      return "cancelled";
    }
    const token = e instanceof CloudCopyError ? e.token : "unknown";
    const message = e instanceof CloudCopyError ? e.message : describe("unknown");
    toast.error("Couldn't keep a copy in the cloud", { id: toastId, description: message, duration: 10000 });
    trackEvent("game_video_upload_failed", { match_id: match.id, stage, error: token });
    if (!(e instanceof CloudCopyError) || !["limit_reached", "feature_disabled", "not_authenticated"].includes(e.token)) {
      Sentry.captureException(e, { tags: { feature: "game_video", stage } });
    }
    announce(match.id);
    return "failed";
  } finally {
    clearJob(match.id);
    void startedAt;
  }
}

/** Stops the running job for a game: the encode or the parts in flight, and the server's upload. */
export async function cancelCloudCopy(matchId: string): Promise<void> {
  const ctrl = running.get(matchId);
  if (!ctrl) return;
  ctrl.abort.abort();
  await invoke("cancel_export", { id: ctrl.jobId }).catch(() => {});
  for (const id of [...ctrl.partJobs]) await invoke("cancel_export", { id }).catch(() => {});
}

/** Removes a game's copy from the cloud (a ready or failed one; an unfinished upload is aborted). */
export async function removeCloudCopy(matchId: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  await cancelCloudCopy(matchId);
  const supabase = createClient();
  const copy = await getGameVideoForMatch(supabase, matchId);
  if (!copy) return true;
  const result =
    copy.status === "uploading"
      ? await abortGameVideo(supabase, { videoId: copy.id })
      : await removeGameVideo(supabase, { videoId: copy.id });
  if (!result.ok && result.error !== "not_found") {
    if (!opts.quiet) toast.error("Couldn't remove the copy", { description: describe(result.error) });
    return false;
  }
  const path = await cachePath(matchId).catch(() => null);
  if (path) await deleteCached(path);
  writeMeta(matchId, null);
  trackEvent("game_video_removed", { match_id: matchId });
  if (!opts.quiet) toast.success("Copy removed from the cloud");
  announce(matchId);
  return true;
}

/**
 * On sign-in: drops copies that waited too long, then picks up every upload
 * the server still lists as in progress whose finished copy is here. One
 * whose copy is gone or differs is abandoned (the server would start over).
 */
export async function resumeCloudCopies(): Promise<void> {
  try {
    await invoke<number>("game_video_prune_cache", { maxAgeDays: CACHE_MAX_AGE_DAYS });
    const supabase = createClient();
    const pending = await listMyGameVideos(supabase, { status: "uploading" });
    for (const row of pending) {
      if (running.has(row.matchId)) continue;
      const path = await cachePath(row.matchId);
      const info = await fileInfo(path);
      const meta = readMeta(row.matchId);
      const resumable = !!info && !!meta && meta.sizeBytes === info.sizeBytes && row.sizeBytes === info.sizeBytes;
      if (!resumable) {
        void abortGameVideo(supabase, { videoId: row.id }).catch(() => {});
        if (info) await deleteCached(path);
        writeMeta(row.matchId, null);
        continue;
      }
      const match = await getMatch(row.matchId);
      if (!match) continue;
      void startCloudCopy(match, { replace: true });
    }
  } catch (e) {
    console.error("[game-video] resume failed:", e);
  }
}
