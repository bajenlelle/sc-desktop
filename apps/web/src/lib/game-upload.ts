"use client";

/**
 * Uploading a game's original video from the browser: the file goes in
 * 32 MiB parts straight to the private bucket through presigned URLs from
 * the game-video function, and our converter makes the 720p copy from it
 * (the row turns `converting`; lib/game-videos.ts follows it from there).
 *
 * One job per game at a time. Progress lives in a small external store so
 * the import page, the game page, the list and the provider's toast follow
 * the same job; in-app navigation never touches it. An interrupted upload
 * resumes when the same file is picked again: the resume key (a byte sample
 * of the file) tells the function which upload to continue, and the parts
 * already on the server are skipped. The pure parts (the key, the meter, the
 * copy, the schedulers) are in @scoutable/shared/lib/game-upload-core.
 */
import { useSyncExternalStore } from "react";
import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import {
  abortGameVideo,
  beginGameVideo,
  completeGameVideo,
  removeGameVideo,
  retryGameVideoConvert,
  signGameVideoParts,
} from "@scoutable/shared/lib/game-video-client";
import { bareEtag, missingParts, partRange, type GameVideoPart } from "@scoutable/shared/lib/game-video-wire";
import { getGameVideoForMatch } from "@scoutable/shared/lib/game-videos-db";
import {
  StepTimeout,
  UploadMeter,
  describeUploadError,
  inParallel,
  resumeKey,
  retryDelayMs,
  sampleRanges,
  withTimeout,
  type GameUploadProgress,
} from "@scoutable/shared/lib/game-upload-core";
import type { ImportAnchor } from "@scoutable/shared/lib/import-session";
import { trackEvent } from "@/lib/analytics";
import { announceGameVideoChange } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";

/** Parts signed per request; a URL lives an hour, far longer than 16 parts take. */
const SIGN_BATCH = 16;
const PARALLEL_PARTS = 3;
const PART_ATTEMPTS = 3;
/** No single step may hang the job: a 32 MiB part on a slow uplink gets this long, a function call this long. */
const PART_TIMEOUT_MS = 15 * 60_000;
const CALL_TIMEOUT_MS = 90_000;
/** How often the store publishes progress while bytes flow, and how long a silence counts as a stall. */
const PUBLISH_EVERY_MS = 250;
const STALL_CHECK_MS = 2_000;

// ---------------------------------------------------------------------------
// The job store
// ---------------------------------------------------------------------------

export interface GameUploadJob extends GameUploadProgress {
  matchId: string;
  fileName: string;
  /** Parts were already on the server when this job began. */
  resumed: boolean;
}

export type GameUploadOutcome = "converting" | "ready" | "already_ready" | "cancelled" | "failed";

export interface GameUploadOutcomeEvent {
  matchId: string;
  title: string;
  outcome: GameUploadOutcome;
}

const jobs = new Map<string, GameUploadJob>();
let jobsSnapshot: GameUploadJob[] = [];
const listeners = new Set<() => void>();
const outcomeListeners = new Set<(e: GameUploadOutcomeEvent) => void>();
const running = new Map<string, { abort: AbortController; xhrs: Set<XMLHttpRequest>; videoId: string | null }>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  jobsSnapshot = [...jobs.values()];
  for (const listener of listeners) listener();
}

function setJob(matchId: string, patch: Partial<GameUploadJob>) {
  const prev = jobs.get(matchId) ?? {
    matchId,
    fileName: "",
    phase: "checking" as const,
    doneBytes: 0,
    totalBytes: 0,
    speedBps: null,
    etaSeconds: null,
    resumed: false,
  };
  jobs.set(matchId, { ...prev, ...patch });
  publish();
}

function clearJob(matchId: string) {
  jobs.delete(matchId);
  running.delete(matchId);
  publish();
}

/** The running upload for a game, or null. */
export function useGameUploadJob(matchId: string | null): GameUploadJob | null {
  return useSyncExternalStore(
    subscribe,
    () => (matchId ? (jobs.get(matchId) ?? null) : null),
    () => null,
  );
}

const NO_JOBS: GameUploadJob[] = [];

/** Every running upload, for the provider's leave warning. */
export function useGameUploadJobs(): GameUploadJob[] {
  return useSyncExternalStore(
    subscribe,
    () => jobsSnapshot,
    () => NO_JOBS,
  );
}

/** Hears how each job ended, wherever the user is by then. */
export function subscribeGameUploadOutcomes(listener: (e: GameUploadOutcomeEvent) => void): () => void {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

function announceOutcome(e: GameUploadOutcomeEvent) {
  for (const l of outcomeListeners) l(e);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type Stage = "check" | "begin" | "upload" | "complete";

class GameUploadError extends Error {
  constructor(
    readonly token: string,
    readonly stage: Stage,
  ) {
    super(token);
  }
}

class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Cancelled();
}

/** Tokens that are the user's situation, not a fault worth a Sentry event. */
const QUIET_TOKENS = new Set(["limit_reached", "feature_disabled", "not_authenticated", "unsupported_type", "too_large", "not_owner"]);

// ---------------------------------------------------------------------------
// One part
// ---------------------------------------------------------------------------

/**
 * PUTs one part to its presigned URL. The ETag the bucket answers with is
 * the part's receipt; the bucket's CORS must expose that header, or the
 * upload can never be completed (`cors_etag`). No Content-Type is sent: a
 * slice of a File carries none, and the signature doesn't cover one.
 */
function putPart(
  url: string,
  blob: Blob,
  opts: { xhrs: Set<XMLHttpRequest>; signal: AbortSignal; onProgress: (loaded: number) => void },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    opts.xhrs.add(xhr);
    const onAbort = () => xhr.abort();
    const finish = (settle: () => void) => {
      opts.xhrs.delete(xhr);
      opts.signal.removeEventListener("abort", onAbort);
      settle();
    };
    opts.signal.addEventListener("abort", onAbort);
    xhr.open("PUT", url);
    xhr.timeout = PART_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => opts.onProgress(e.loaded);
    xhr.onload = () =>
      finish(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag");
          if (etag) resolve(bareEtag(etag));
          else reject(new GameUploadError("cors_etag", "upload"));
        } else {
          reject(new GameUploadError(`part_status_${xhr.status}`, "upload"));
        }
      });
    xhr.onerror = () => finish(() => reject(new GameUploadError("network", "upload")));
    xhr.ontimeout = () => finish(() => reject(new StepTimeout("part")));
    xhr.onabort = () => finish(() => reject(new Cancelled()));
    xhr.send(blob);
  });
}

async function readSamples(file: File): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const { offset, length } of sampleRanges(file.size)) {
    out.push(new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface StartGameUploadOptions {
  matchId: string;
  /** The game's title, for the toast when the upload finishes off-page. */
  title: string;
  file: File;
  anchor: ImportAnchor;
  /** Start over although a ready copy exists (the user said so in the replace dialog). */
  replace?: boolean;
  /** The game has an unfinished upload: a file the server doesn't recognise starts over, and says so. */
  expectResume?: boolean;
}

/**
 * Uploads the original. Resolves "converting" once the server has every
 * part and has handed the file to the converter; "already_ready" when the
 * game already has a copy and `replace` wasn't set (nothing was uploaded;
 * ask, then call again with `replace: true`); "cancelled" or "failed" (the
 * toast has said why). A second call for a game still uploading resolves
 * "failed" at once.
 */
export async function startGameUpload(opts: StartGameUploadOptions): Promise<GameUploadOutcome> {
  const { matchId, file, anchor } = opts;
  if (running.has(matchId)) return "failed";

  const supabase = createClient();
  const abort = new AbortController();
  const ctrl = { abort, xhrs: new Set<XMLHttpRequest>(), videoId: null as string | null };
  running.set(matchId, ctrl);
  setJob(matchId, { phase: "checking", fileName: file.name, totalBytes: file.size, doneBytes: 0, speedBps: null, etaSeconds: null, resumed: false });

  let stage: Stage = "check";
  let doneFraction = 0;
  let stallTimer: number | undefined;

  try {
    stage = "begin";
    const key = await resumeKey(file.size, await readSamples(file));
    throwIfAborted(abort.signal);
    const begun = await withTimeout(
      beginGameVideo(supabase, {
        matchId,
        sizeBytes: file.size,
        durationSeconds: null,
        width: null,
        height: null,
        fingerprintKey: key,
        origin: "browser",
        sourceName: file.name,
        anchorKind: anchor.kind,
        anchorLabel: anchor.label,
        anchorRealWorldTime: anchor.realWorldTime,
        replace: opts.replace === true,
      }),
      CALL_TIMEOUT_MS,
      "begin",
    );
    if (!begun.ok) {
      if (begun.error === "already_ready") {
        clearJob(matchId);
        return "already_ready";
      }
      throw new GameUploadError(begun.error, "begin");
    }
    const videoId = begun.data.videoId;
    ctrl.videoId = videoId;
    if (opts.expectResume && !begun.data.resumed) {
      toast.info("That's a different file, so the upload starts over");
    }
    trackEvent("game_video_upload_started", {
      match_id: matchId,
      origin: "browser",
      source_mb: Math.round(file.size / 1e6),
      resumed: begun.data.resumed,
    });

    // The parts: new, or resumed where the last attempt stopped.
    stage = "upload";
    const plan = { partSize: begun.data.partSize, count: begun.data.partCount };
    const etags = new Map<number, string>(begun.data.completedParts.map((p) => [p.partNumber, p.etag]));
    const missing = missingParts(plan.count, begun.data.completedParts);
    const totalBytes = file.size;
    let committedBytes = 0;
    for (const n of etags.keys()) committedBytes += partRange(n, plan, totalBytes).length;
    const inFlight = new Map<number, number>();
    const meter = new UploadMeter();
    const uploadStart = Date.now();
    let lastPublish = 0;
    let lastProgressAt = Date.now();

    const report = (force = false) => {
      let doneBytes = committedBytes;
      for (const loaded of inFlight.values()) doneBytes += loaded;
      doneBytes = Math.min(doneBytes, totalBytes);
      doneFraction = totalBytes > 0 ? doneBytes / totalBytes : 0;
      const now = Date.now();
      meter.record(doneBytes, now);
      if (!force && now - lastPublish < PUBLISH_EVERY_MS) return;
      lastPublish = now;
      setJob(matchId, {
        phase: "uploading",
        doneBytes,
        totalBytes,
        speedBps: meter.speedBps,
        etaSeconds: meter.etaSeconds(totalBytes - doneBytes),
        resumed: begun.data.resumed,
      });
    };
    report(true);
    // A stalled connection shows as a falling speed, not a frozen number.
    stallTimer = window.setInterval(() => {
      if (Date.now() - lastProgressAt < STALL_CHECK_MS) return;
      meter.stall(Date.now());
      const job = jobs.get(matchId);
      if (job) setJob(matchId, { speedBps: meter.speedBps, etaSeconds: meter.etaSeconds(totalBytes - job.doneBytes) });
    }, STALL_CHECK_MS);

    const signed = new Map<number, string>();
    const sign = async (numbers: number[]) => {
      const r = await withTimeout(signGameVideoParts(supabase, { videoId, partNumbers: numbers }), CALL_TIMEOUT_MS, "sign_parts");
      if (!r.ok) throw new GameUploadError(r.error, "upload");
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
          const url = signed.get(partNumber);
          if (!url) throw new GameUploadError("sign_missing", "upload");
          try {
            const etag = await putPart(url, file.slice(offset, offset + length), {
              xhrs: ctrl.xhrs,
              signal: abort.signal,
              onProgress: (loaded) => {
                inFlight.set(partNumber, Math.min(loaded, length));
                lastProgressAt = Date.now();
                report();
              },
            });
            inFlight.delete(partNumber);
            etags.set(partNumber, etag);
            committedBytes += length;
            report(true);
            return;
          } catch (e) {
            inFlight.delete(partNumber);
            if (e instanceof Cancelled || abort.signal.aborted) throw new Cancelled();
            // The bucket's CORS is wrong: every part would fail the same way.
            if (e instanceof GameUploadError && e.token === "cors_etag") throw e;
            if (attempt >= PART_ATTEMPTS) {
              throw new GameUploadError(e instanceof GameUploadError && e.token === "network" ? "network" : "part_failed", "upload");
            }
            // An expired URL answers 403: sign that part again before retrying.
            if (e instanceof GameUploadError && e.token === "part_status_403") await sign([partNumber]);
            await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
          }
        }
      });
    }

    stage = "complete";
    window.clearInterval(stallTimer);
    stallTimer = undefined;
    setJob(matchId, { phase: "finishing", doneBytes: totalBytes, totalBytes, etaSeconds: null });
    const parts: GameVideoPart[] = [...etags.entries()]
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);
    const done = await withTimeout(completeGameVideo(supabase, { videoId, parts }), CALL_TIMEOUT_MS, "complete");
    if (!done.ok) throw new GameUploadError(done.error, "complete");

    trackEvent("game_video_uploaded", {
      match_id: matchId,
      origin: "browser",
      source_mb: Math.round(totalBytes / 1e6),
      upload_s: Math.round((Date.now() - uploadStart) / 1000),
      resumed: begun.data.resumed,
    });
    // A desktop copy would answer "ready"; a browser original is converted first.
    const outcome: GameUploadOutcome = done.data.status === "ready" ? "ready" : "converting";
    // The row's new state is announced before the job leaves the store, so no
    // view sees the old row without a job in between.
    announceGameVideoChange(matchId, outcome);
    clearJob(matchId);
    announceOutcome({ matchId, title: opts.title, outcome });
    return outcome;
  } catch (e) {
    for (const xhr of ctrl.xhrs) xhr.abort();
    if (e instanceof Cancelled || abort.signal.aborted) {
      // Stopped on purpose: nothing of it is kept on the server.
      trackEvent("game_video_upload_cancelled", { match_id: matchId, origin: "browser", done_fraction: Math.round(doneFraction * 100) / 100 });
      if (ctrl.videoId) {
        // The row goes with the upload; the re-read confirms once the abort has landed.
        announceGameVideoChange(matchId, "removed");
        void abortGameVideo(supabase, { videoId: ctrl.videoId })
          .catch(() => {})
          .finally(() => announceGameVideoChange(matchId));
      } else {
        announceGameVideoChange(matchId);
      }
      clearJob(matchId);
      announceOutcome({ matchId, title: opts.title, outcome: "cancelled" });
      return "cancelled";
    }
    const token = e instanceof GameUploadError ? e.token : e instanceof StepTimeout ? "timeout" : "unknown";
    toast.error("Couldn't upload the video", { description: describeUploadError(token), duration: 10000 });
    trackEvent("game_video_upload_failed", { match_id: matchId, origin: "browser", stage, error: token });
    if (!QUIET_TOKENS.has(token)) Sentry.captureException(e, { tags: { feature: "game_video", stage } });
    clearJob(matchId);
    announceGameVideoChange(matchId);
    announceOutcome({ matchId, title: opts.title, outcome: "failed" });
    return "failed";
  } finally {
    if (stallTimer !== undefined) window.clearInterval(stallTimer);
    running.delete(matchId);
  }
}

/** Stops the running upload for a game: the parts in flight, and the server's upload. */
export async function cancelGameUpload(matchId: string): Promise<void> {
  const ctrl = running.get(matchId);
  if (!ctrl) return;
  ctrl.abort.abort();
  for (const xhr of [...ctrl.xhrs]) xhr.abort();
}

/**
 * Removes a game's video from the cloud: a ready or failed copy is deleted
 * (with its original), an unfinished upload is aborted. True when nothing
 * of it is left.
 */
export async function removeCloudGame(matchId: string): Promise<boolean> {
  await cancelGameUpload(matchId);
  const supabase = createClient();
  const video = await getGameVideoForMatch(supabase, matchId);
  if (!video) return true;
  const result =
    video.status === "uploading" ? await abortGameVideo(supabase, { videoId: video.id }) : await removeGameVideo(supabase, { videoId: video.id });
  if (!result.ok && result.error !== "not_found") {
    toast.error("Couldn't remove the video", { description: describeUploadError(result.error) });
    return false;
  }
  trackEvent("game_video_removed", { match_id: matchId });
  announceGameVideoChange(matchId, "removed");
  return true;
}

/** Runs a failed conversion again from the kept original. False (with a toast) when the server refused. */
export async function retryCloudGameConvert(matchId: string, videoId: string): Promise<boolean> {
  const result = await retryGameVideoConvert(createClient(), { videoId });
  if (!result.ok) {
    toast.error(
      result.error === "source_expired" ? "The uploaded file is no longer kept" : "Couldn't start the conversion",
      { description: result.error === "source_expired" ? "Upload the video again." : describeUploadError(result.error) },
    );
    return false;
  }
  trackEvent("game_video_convert_retried", { match_id: matchId });
  announceGameVideoChange(matchId, "converting");
  return true;
}
