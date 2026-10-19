/**
 * The renderer: one render job in (a web playlist's clips to cut), the clip
 * files out in the public media bucket. Runs in the container the Worker
 * starts with `entrypoint: ["tini", "--", "node", "--import", "tsx", "src/render.ts"]`
 * (src/worker.ts, POST /render) and, with the same env, on a Mac:
 * `npx tsx workers/game-video-convert/src/render.ts`.
 *
 *   render_take → for each clip (three at a time): ffmpeg cut from the copy's
 *   presigned GET with the desktop's arguments (src/ship.ts) → size and
 *   duration checks → PUT to the clip's presigned media URL → one retry pass
 *   over the clips that failed → render_done with a result per clip. Progress
 *   goes out every few clips and every 30 s. When every clip failed for
 *   reasons outside the clips themselves, render_failed (retryable) hands the
 *   job back instead; any other failure → render_failed with a classified error.
 *
 * Env: RENDER_JOB_ID, GAME_VIDEO_FN_URL, WORKER_SECRET,
 *      ALIVE_URL (optional; POSTed every 5 min with ?attempt=, and &final=1 once reported),
 *      FFMPEG (binary; default `ffmpeg` on PATH), WORK_DIR (default a fresh temp dir,
 *      removed at the end; a given one is kept), PORT (health server; default 8080,
 *      none in a dry run unless set).
 *
 * DRY_RUN_PLAN=<json>: no function calls and no upload. The plan
 *      `{ "source": "<file or URL>", "clips": [{ "start": 10, "end": 23 }, …] }` is
 *      cut into WORK_DIR (`0.mp4`, `1.mp4`, …; kept when WORK_DIR is given) and the
 *      per-clip results are printed, so the cut can be checked on a file here.
 *
 * Exit codes: 0 done (also for job_busy, wrong_status and stale_attempt: nothing to
 * do here), 1 failed and reported, 143 SIGTERM (ffmpeg killed, render_failed('sigterm')
 * sent). Every line this prints is `[render <jobId> a<attempt>] key=value …` with no
 * URL or secret in it (src/log.ts).
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG } from "@scoutable/node-video/lib/ffmpeg";
import { GAME_VIDEO_PROGRESS_INTERVAL_SECONDS, type RenderShipClip, type RenderTakeResponse } from "@scoutable/shared/lib/game-video-wire";
import { Aborted, ConvertFailure, classifyFailure, throwIfAborted } from "./errors.ts";
import { FunctionError, RenderClient, StaleAttempt } from "./function-client.ts";
import { createLogger, redact, type Logger } from "./log.ts";
import { AlivePinger, Progress, SIGTERM_EXIT, SIGTERM_REPORT_TIMEOUT_MS, env, installSignalHandlers, readPort, runMain, startHealthServer, startHeartbeat } from "./runtime.ts";
import { shipClips, type ShipOutcome } from "./ship.ts";

/** A progress report goes out after this many clips, besides the 30 s heartbeat. */
const PROGRESS_EVERY_CLIPS = 3;
/** A render's progress is linear in clips: the one phase that moves is `cut`. */
type RenderPhase = "take" | "cut" | "done";

// ── configuration ─────────────────────────────────────────────────────────────

interface Config {
  jobId: string;
  dryRunPlan: string | null;
  fnUrl: string | null;
  workerSecret: string | null;
  aliveUrl: string | null;
  workDir: string | null;
  port: number | null;
}

function readConfig(): Config {
  const dryRunPlan = env("DRY_RUN_PLAN") ?? null;
  return {
    jobId: env("RENDER_JOB_ID") ?? (dryRunPlan ? "dry-run" : ""),
    dryRunPlan,
    fnUrl: env("GAME_VIDEO_FN_URL") ?? null,
    workerSecret: env("WORKER_SECRET") ?? null,
    aliveUrl: env("ALIVE_URL") ?? null,
    workDir: env("WORK_DIR") ?? null,
    port: readPort(dryRunPlan !== null),
  };
}

interface JobContext {
  jobId: string;
  attempt: number;
  log: Logger;
  abort: AbortController;
  workDir: string;
  progress: Progress<RenderPhase>;
}

// ── the job ───────────────────────────────────────────────────────────────────

/** The cuts, with a log line per clip and a progress report every few. */
async function cutAll(ctx: JobContext, take: Pick<RenderTakeResponse, "copies" | "clips">, beat: (() => void) | null, keepFiles = false): Promise<ShipOutcome> {
  const total = take.clips.length;
  ctx.progress.set("cut", total === 0 ? 1 : 0, { done: 0, total });
  return shipClips({
    copies: take.copies,
    clips: take.clips,
    workDir: ctx.workDir,
    signal: ctx.abort.signal,
    ffmpeg: FFMPEG,
    log: ctx.log,
    ...(keepFiles ? { deps: { remove: async () => {} } } : {}),
    onClipDone: (done, total, outcome) => {
      ctx.progress.set("cut", total > 0 ? done / total : 1, { done, total });
      ctx.log({
        phase: "clip",
        match: outcome.clip.matchId,
        event: outcome.clip.eventId,
        start: outcome.clip.start,
        end: outcome.clip.end,
        ok: outcome.ok,
        ...(outcome.ok ? { s: outcome.durationS, kb: Math.round((outcome.bytes ?? 0) / 1024) } : { error: outcome.error, detail: outcome.detail ? ctx.log.safe(outcome.detail) : undefined }),
      });
      if (beat && done % PROGRESS_EVERY_CLIPS === 0 && done < total) beat();
    },
  });
}

async function runJob(cfg: Config, ctx: JobContext): Promise<number> {
  if (!cfg.jobId || !cfg.fnUrl || !cfg.workerSecret) {
    ctx.log({ phase: "config", error: "RENDER_JOB_ID, GAME_VIDEO_FN_URL and WORKER_SECRET are required" });
    return 1;
  }
  const client = new RenderClient({ url: cfg.fnUrl, secret: cfg.workerSecret, jobId: cfg.jobId });

  let take: RenderTakeResponse;
  try {
    take = await client.take();
  } catch (e) {
    if (e instanceof FunctionError && (e.token === "job_busy" || e.token === "wrong_status")) {
      ctx.log({ phase: "take", result: e.token, note: e.token === "job_busy" ? "another renderer holds this job" : "the job is not waiting for a renderer" });
      return 0;
    }
    ctx.log({ phase: "take", error: ctx.log.safe(e) });
    return 1;
  }
  ctx.attempt = take.attempt;
  ctx.log.setAttempt(take.attempt);
  ctx.log({ phase: "take", kind: take.kind, clips: take.clips.length, copies: Object.keys(take.copies).length });

  const alive = cfg.aliveUrl ? new AlivePinger(cfg.aliveUrl, take.attempt, ctx.log) : null;
  alive?.start();
  const heartbeat = startHeartbeat({
    intervalMs: GAME_VIDEO_PROGRESS_INTERVAL_SECONDS * 1000,
    progress: ctx.progress,
    report: (value) => client.progress(take.attempt, value),
    abort: ctx.abort,
    log: ctx.log,
  });

  let reported = false;
  let code = 1;
  try {
    // The export kind arrives in a later milestone; a job of it can't be run by this build.
    if (take.kind !== "ship") throw new ConvertFailure("unsupported_kind", false, take.kind);
    const out = await cutAll(ctx, take, heartbeat.beat);
    throwIfAborted(ctx.abort.signal);
    if (out.infrastructureOnly) {
      // Not one clip could be cut, and none through any fault of its own: another attempt, with fresh URLs, gets the job.
      const first = out.outcomes.find((x) => !x.ok);
      throw new ConvertFailure(first?.error ?? "upload_failed", true, first?.detail);
    }
    const done = await client.done(take.attempt, out.results);
    reported = true;
    ctx.progress.set("done", 1);
    ctx.log({ phase: "done", status: done.status, shipped: done.shipped, failed: done.failed, superseded: done.superseded });
    code = 0;
  } catch (e) {
    if (e instanceof StaleAttempt || (e instanceof Aborted && e.reason === "stale_attempt")) {
      ctx.log({ phase: "stale", note: "another attempt owns the job; stopping without a report" });
      code = 0;
    } else {
      const sigterm = e instanceof Aborted && e.reason === "sigterm";
      const { error, retryable } = classifyFailure(e);
      ctx.log({ phase: "failed", error, retryable, detail: ctx.log.safe(e) });
      try {
        const r = await client.failed(take.attempt, error, retryable, sigterm ? { tries: 1, timeoutMs: SIGTERM_REPORT_TIMEOUT_MS } : {});
        reported = true;
        ctx.log({ phase: "failed", reported: r.status });
      } catch (re) {
        if (re instanceof StaleAttempt) ctx.log({ phase: "stale", note: "another attempt took the job meanwhile" });
        else ctx.log({ phase: "failed", report_error: ctx.log.safe(re) });
      }
      code = sigterm ? SIGTERM_EXIT : 1;
    }
  } finally {
    heartbeat.stop();
    alive?.stop();
    // Tells the Worker the function has heard from this run, so its onStop safety net stays quiet.
    if (reported) await alive?.ping(true);
  }
  return code;
}

// ── dry run ───────────────────────────────────────────────────────────────────

interface DryRunPlan {
  source: string;
  clips: { start: number; end: number }[];
}

function parseDryRunPlan(text: string): DryRunPlan {
  const raw = JSON.parse(text) as Partial<DryRunPlan>;
  if (typeof raw.source !== "string" || !Array.isArray(raw.clips) || raw.clips.length === 0) throw new Error("DRY_RUN_PLAN needs { source, clips: [{ start, end }] }");
  const clips = raw.clips.map((c, i) => {
    if (typeof c?.start !== "number" || typeof c?.end !== "number" || !(c.end > c.start)) throw new Error(`DRY_RUN_PLAN clip ${i}: start and end must be numbers with end > start`);
    return { start: c.start, end: c.end };
  });
  return { source: raw.source, clips };
}

async function dryRun(cfg: Config, ctx: JobContext, planText: string): Promise<number> {
  try {
    const plan = parseDryRunPlan(planText);
    const clips: RenderShipClip[] = plan.clips.map((c, i) => ({
      clipId: String(i),
      matchId: "dry-run",
      eventId: i,
      videoId: "dry-run",
      start: c.start,
      end: c.end,
      key: `clips/dry-run/${i}_pre0.0_post0.0_s${c.start.toFixed(1)}.mp4`,
      putUrl: "dry-run",
    }));
    ctx.log({ phase: "dry_run", source: plan.source.replace(/^https?:\/\/.*/, "<url>"), clips: clips.length, work_dir: ctx.workDir, ffmpeg: FFMPEG === "ffmpeg" ? "PATH" : "FFMPEG env" });
    const out = await shipClips({
      copies: { "dry-run": { url: plan.source } },
      clips,
      workDir: ctx.workDir,
      signal: ctx.abort.signal,
      ffmpeg: FFMPEG,
      log: ctx.log,
      // No upload, and the cuts stay where they are for a look.
      deps: { put: async () => 200, remove: async () => {} },
      onClipDone: (done, total, outcome) => {
        ctx.progress.set("cut", total > 0 ? done / total : 1, { done, total });
        ctx.log({ phase: "clip", index: outcome.clip.eventId, start: outcome.clip.start, end: outcome.clip.end, ok: outcome.ok, s: outcome.durationS, kb: outcome.bytes ? Math.round(outcome.bytes / 1024) : undefined, error: outcome.error, detail: outcome.detail ? ctx.log.safe(outcome.detail) : undefined });
      },
    });
    ctx.log({ phase: "dry_run", result: out.failed === 0 ? "ok" : "some clips failed", shipped: out.shipped, failed: out.failed, files: cfg.workDir ? ctx.workDir : "removed with the temp dir" });
    console.log(JSON.stringify({ action: "render_done", jobId: cfg.jobId, attempt: 0, results: out.results }, null, 2));
    return out.failed === 0 ? 0 : 1;
  } catch (e) {
    const { error, retryable } = classifyFailure(e);
    ctx.log({ phase: "dry_run", result: "failed", error, retryable, detail: ctx.log.safe(e) });
    return e instanceof Aborted && e.reason === "sigterm" ? SIGTERM_EXIT : 1;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const cfg = readConfig();
  const log = createLogger({ program: "render", id: cfg.jobId || "?", secrets: [cfg.workerSecret, cfg.aliveUrl] });
  const abort = new AbortController();
  installSignalHandlers(abort, log);

  const ctx: JobContext = {
    jobId: cfg.jobId,
    attempt: 0,
    log,
    abort,
    workDir: cfg.workDir ?? (await mkdtemp(join(tmpdir(), "game-video-render-"))),
    progress: new Progress<RenderPhase>(log),
  };
  if (cfg.workDir) await mkdir(cfg.workDir, { recursive: true });
  const health = cfg.port ? startHealthServer(cfg.port, () => ({ jobId: ctx.jobId, attempt: ctx.attempt, phase: ctx.progress.phase, progress: ctx.progress.value }), log) : null;
  try {
    return cfg.dryRunPlan ? await dryRun(cfg, ctx, cfg.dryRunPlan) : await runJob(cfg, ctx);
  } finally {
    health?.close();
    if (!cfg.workDir) await rm(ctx.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

runMain("render", main, (message) => redact(message, []));
