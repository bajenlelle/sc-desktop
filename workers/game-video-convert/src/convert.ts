/**
 * The converter: one browser-uploaded game in, one 720p copy with its
 * tip-off out. Runs in the container the Worker starts (src/worker.ts) and,
 * with the same env, on a Mac: `npx tsx workers/game-video-convert/src/convert.ts`.
 *
 *   job_take → download the original → probe → content fingerprint → shared
 *   hints (as the bot) → ffmpeg 720p with progress every 30 s → probe the copy
 *   → upload its parts → tip-off detection when no hint hit (as the bot)
 *   → job_done. Any failure → job_failed with a classified error.
 *
 * Env: VIDEO_ID, GAME_VIDEO_FN_URL, WORKER_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      BOT_EMAIL + BOT_PASSWORD (hints and detection; unset → the sync is 'not_found'),
 *      ALIVE_URL (optional; POSTed every 5 min with ?attempt=, and &final=1 once reported),
 *      FFMPEG (binary; default `ffmpeg` on PATH), WORK_DIR (default a fresh temp dir,
 *      removed at the end; a given one is kept), PORT (health server; default 8080,
 *      none in a dry run unless set).
 *
 * DRY_RUN_SOURCE=<file>: no function calls and no upload. Probe → fingerprint →
 *      hints → encode into WORK_DIR → detection, then the job_done payload it would
 *      have sent is printed. SUPABASE_URL/SUPABASE_ANON_KEY fall back to the VITE_
 *      values in apps/desktop/.env.staging (or DRY_RUN_ENV_FILE), never printed.
 *
 * Exit codes: 0 done (also for job_busy and stale_attempt: nothing to do here),
 * 1 failed and reported, 143 SIGTERM (ffmpeg killed, job_failed('sigterm') sent).
 * Every line this prints is `[convert <videoId> a<attempt>] key=value …` with no
 * URL or secret in it (src/log.ts).
 */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fingerprint } from "@scoutable/node-video/lib/detect-local";
import { FFMPEG, probe, type Probe } from "@scoutable/node-video/lib/ffmpeg";
import { copyLooksWhole, progressFraction, sourceRefusal, type ConvertPhase } from "@scoutable/shared/lib/game-video-convert";
import {
  GAME_VIDEO_PROGRESS_INTERVAL_SECONDS,
  sourceExtension,
  type GameVideoJobDoneResponse,
  type GameVideoJobMatch,
  type GameVideoJobSync,
  type GameVideoJobTakeResponse,
} from "@scoutable/shared/lib/game-video-wire";
import { detectTipoff, lookupHint, signInBot, type BotCredentials } from "./detect.ts";
import { downloadSource } from "./download.ts";
import { encodeCopy } from "./encode.ts";
import { parseEnvFile } from "./env-file.ts";
import { Aborted, ConvertFailure, classifyFailure, throwIfAborted } from "./errors.ts";
import { FunctionClient, FunctionError, StaleAttempt, type JobDoneBody } from "./function-client.ts";
import { createLogger, redact, type Logger } from "./log.ts";
import { syncSkipReason } from "./sync.ts";
import { uploadCopy } from "./upload.ts";

const ALIVE_INTERVAL_MS = 5 * 60 * 1000;
const ALIVE_TIMEOUT_MS = 10_000;
const DEFAULT_PORT = 8080;
const SIGTERM_EXIT = 143;
const SIGTERM_GRACE_MS = 5000;
const SIGTERM_REPORT_TIMEOUT_MS = 4000;
const COPY_TOLERANCE_S = 2;
const EXIT_GRACE_MS = 1500;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_ENV_FILE = join(REPO_ROOT, "apps/desktop/.env.staging");

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

// ── configuration ─────────────────────────────────────────────────────────────

interface Config {
  videoId: string;
  dryRunSource: string | null;
  fnUrl: string | null;
  workerSecret: string | null;
  supabaseUrl: string | null;
  anonKey: string | null;
  botEmail: string | null;
  botPassword: string | null;
  aliveUrl: string | null;
  workDir: string | null;
  port: number | null;
  /** Where the Supabase URL and key came from, for the log. */
  supabaseSource: "env" | "env-file" | "none";
}

function readConfig(): Config {
  const dryRunSource = env("DRY_RUN_SOURCE") ?? null;
  let supabaseUrl = env("SUPABASE_URL") ?? null;
  let anonKey = env("SUPABASE_ANON_KEY") ?? null;
  let supabaseSource: Config["supabaseSource"] = supabaseUrl && anonKey ? "env" : "none";
  if (dryRunSource && !(supabaseUrl && anonKey)) {
    // A dry run on a developer's machine: the staging project's public values, read from the file, never printed.
    let text = "";
    try {
      text = readFileSync(env("DRY_RUN_ENV_FILE") ?? DEFAULT_ENV_FILE, "utf8");
    } catch {
      text = "";
    }
    const vars = parseEnvFile(text);
    if (vars.VITE_SUPABASE_URL && vars.VITE_SUPABASE_ANON_KEY) {
      supabaseUrl = vars.VITE_SUPABASE_URL;
      anonKey = vars.VITE_SUPABASE_ANON_KEY;
      supabaseSource = "env-file";
    }
  }
  const portRaw = env("PORT");
  const port = portRaw ? Number(portRaw) : dryRunSource ? null : DEFAULT_PORT;
  return {
    videoId: env("VIDEO_ID") ?? (dryRunSource ? "dry-run" : ""),
    dryRunSource,
    fnUrl: env("GAME_VIDEO_FN_URL") ?? null,
    workerSecret: env("WORKER_SECRET") ?? null,
    supabaseUrl,
    anonKey,
    botEmail: env("BOT_EMAIL") ?? null,
    botPassword: env("BOT_PASSWORD") ?? null,
    aliveUrl: env("ALIVE_URL") ?? null,
    workDir: env("WORK_DIR") ?? null,
    port: port && Number.isInteger(port) && port > 0 ? port : null,
    supabaseSource,
  };
}

function botCredentials(cfg: Config): BotCredentials | null {
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.botEmail || !cfg.botPassword) return null;
  return { supabaseUrl: cfg.supabaseUrl, anonKey: cfg.anonKey, email: cfg.botEmail, password: cfg.botPassword };
}

// ── job context ───────────────────────────────────────────────────────────────

/** The job's single progress figure, with a log line whenever a phase starts or passes another tenth. */
class Progress {
  phase: ConvertPhase | "start" = "start";
  value = 0;
  detail: Record<string, unknown> = {};
  private logged = { phase: "" as string, step: -1 };

  constructor(private readonly log: Logger) {}

  set(phase: ConvertPhase, fraction: number, detail: Record<string, unknown> = {}): void {
    const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    this.phase = phase;
    this.value = progressFraction(phase, f);
    this.detail = detail;
    const step = Math.floor(f * 10);
    if (phase !== this.logged.phase || step !== this.logged.step) {
      this.logged = { phase, step };
      this.line();
    }
  }

  line(extra: Record<string, unknown> = {}): void {
    this.log({ phase: this.phase, pct: Math.round(this.value * 100), ...this.detail, ...extra });
  }
}

interface JobContext {
  videoId: string;
  attempt: number;
  log: Logger;
  abort: AbortController;
  workDir: string;
  progress: Progress;
}

/** Keeps the Worker's inactivity clock running while the job lasts, and tells it when the job has reported. */
class AlivePinger {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly attempt: number,
    private readonly log: Logger,
  ) {}

  start(): void {
    void this.ping();
    this.timer = setInterval(() => void this.ping(), ALIVE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async ping(final = false): Promise<void> {
    try {
      const u = new URL(this.url);
      u.searchParams.set("attempt", String(this.attempt));
      if (final) u.searchParams.set("final", "1");
      const res = await fetch(u, { method: "POST", signal: AbortSignal.timeout(ALIVE_TIMEOUT_MS) });
      if (!res.ok) this.log({ phase: "alive", status: res.status });
    } catch (e) {
      this.log({ phase: "alive", error: this.log.safe(e) });
    }
  }
}

function startHealthServer(port: number, snapshot: () => unknown, log: Logger): http.Server {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(snapshot()));
  });
  server.on("error", (e) => log({ phase: "health", error: log.safe(e) }));
  server.listen(port, "0.0.0.0");
  server.unref();
  return server;
}

// ── steps ─────────────────────────────────────────────────────────────────────

/** ffmpeg's view of the original, or the final refusal it earns. */
async function probeSource(path: string): Promise<Probe> {
  const p = await probe(path);
  if (!p) throw new ConvertFailure(sourceRefusal(null) ?? "unsupported_type", false, "ffmpeg could not read the file");
  const refusal = sourceRefusal({ durationS: p.durationS, width: p.width, height: p.height, hasVideo: p.width > 0 && p.height > 0 });
  if (refusal) throw new ConvertFailure(refusal, false, `${p.durationS} s ${p.width}x${p.height}`);
  return p;
}

/** The hint lookup and the detector only ever cost the job a log line: a failure there leaves the sync undecided. */
async function withBot<T>(bot: BotCredentials, log: Logger, phase: string, fn: (supabase: SupabaseClient) => Promise<T>): Promise<T | null> {
  try {
    return await fn(await signInBot(bot));
  } catch (e) {
    if (e instanceof Aborted) throw e;
    log({ phase, error: log.safe(e) });
    return null;
  }
}

interface EncodedCopy {
  path: string;
  probe: Probe;
  sizeBytes: number;
}

async function encodeAndVerify(ctx: JobContext, source: string, src: Probe): Promise<EncodedCopy> {
  // ffmpeg picks the muxer from the extension (the shared argument list carries no -f), so the
  // unfinished file keeps .mp4 and is renamed once ffmpeg has finished its faststart pass.
  const partPath = join(ctx.workDir, "copy.part.mp4");
  const copyPath = join(ctx.workDir, "copy.mp4");
  ctx.progress.set("encode", 0);
  const { wallS } = await encodeCopy({
    ffmpeg: FFMPEG,
    input: source,
    output: partPath,
    scaleDown: src.height > 720,
    durationS: src.durationS,
    signal: ctx.abort.signal,
    onProgress: (p) => ctx.progress.set("encode", p.fraction, p.speed ? { speed: p.speed } : {}),
  });
  await rename(partPath, copyPath);
  const copy = await probe(copyPath);
  if (!copy || !copyLooksWhole(src.durationS, copy.durationS, COPY_TOLERANCE_S)) {
    throw new ConvertFailure("transcode_incomplete", true, `the copy is ${copy ? `${copy.durationS} s` : "unreadable"}, the original ${src.durationS} s`);
  }
  const sizeBytes = (await stat(copyPath)).size;
  ctx.log({ phase: "encode", done: true, s: Math.round(wallS), x: Number((src.durationS / Math.max(1, wallS)).toFixed(1)), copy_mb: Math.round(sizeBytes / 1e6), width: copy.width, height: copy.height, fps: copy.fps });
  return { path: copyPath, probe: copy, sizeBytes };
}

/** The sync before the encode: skipped for games without a tip-off anchor, else a shared hint when one matches. */
async function syncBeforeEncode(ctx: JobContext, cfg: Config, match: GameVideoJobMatch, fp: Awaited<ReturnType<typeof fingerprint>>): Promise<GameVideoJobSync | null> {
  const skip = syncSkipReason(match);
  if (skip) {
    ctx.log({ phase: "hints", skipped: skip });
    return { outcome: "skipped" };
  }
  const bot = botCredentials(cfg);
  if (!bot) {
    ctx.log({ phase: "hints", skipped: "no_bot", note: "BOT_EMAIL/BOT_PASSWORD unset: no hint lookup and no detection" });
    return null;
  }
  return withBot(bot, ctx.log, "hints", (supabase) => lookupHint(supabase, fp, match, ctx.log));
}

/** The sync after the upload when nothing decided it yet: the detector, or 'not_found' when it can't run or fails. */
async function syncByDetection(ctx: JobContext, cfg: Config, match: GameVideoJobMatch, source: string, src: Probe, fp: Awaited<ReturnType<typeof fingerprint>>): Promise<GameVideoJobSync> {
  ctx.progress.set("detect", 0);
  const bot = botCredentials(cfg);
  if (!bot) {
    ctx.log({ phase: "detect", outcome: "not_found", skipped: "no_bot" });
    return { outcome: "not_found" };
  }
  const found = await withBot(bot, ctx.log, "detect", (supabase) =>
    detectTipoff({ supabase, source, probe: src, fp, match, signal: ctx.abort.signal, log: ctx.log, onProgress: (f) => ctx.progress.set("detect", f) }),
  );
  throwIfAborted(ctx.abort.signal);
  return found ?? { outcome: "not_found" };
}

// ── the job ───────────────────────────────────────────────────────────────────

async function convert(cfg: Config, ctx: JobContext, client: FunctionClient, take: GameVideoJobTakeResponse): Promise<GameVideoJobDoneResponse> {
  const { signal } = ctx.abort;
  const ext = (take.sourceName ? sourceExtension(take.sourceName) : null) ?? "bin";
  const sourcePath = join(ctx.workDir, `source.${ext}`);
  ctx.progress.set("download", 0);
  await downloadSource({
    url: take.sourceUrl,
    sizeBytes: take.sourceSizeBytes,
    dest: sourcePath,
    signal,
    onProgress: (done) => ctx.progress.set("download", take.sourceSizeBytes > 0 ? done / take.sourceSizeBytes : 1),
    onRetry: (n, e) => ctx.log({ phase: "download", retry: n, error: ctx.log.safe(e) }),
  });

  const src = await probeSource(sourcePath);
  ctx.log({ phase: "probe", duration_s: Math.round(src.durationS), width: src.width, height: src.height, fps: src.fps });
  const fp = await fingerprint(sourcePath, src);
  ctx.log({ phase: "fingerprint", hashes: fp.hashes.length, key: fp.key.slice(0, 12) });
  let sync = await syncBeforeEncode(ctx, cfg, take.match, fp);
  throwIfAborted(signal);

  const copy = await encodeAndVerify(ctx, sourcePath, src);

  ctx.progress.set("upload", 0);
  const parts = await uploadCopy({
    path: copy.path,
    sizeBytes: copy.sizeBytes,
    partSize: take.partSize,
    signal,
    sign: async (numbers) => (await client.signParts(take.attempt, numbers)).urls,
    onProgress: (done, total) => ctx.progress.set("upload", total > 0 ? done / total : 1),
    onRetry: (part, n, e) => ctx.log({ phase: "upload", part, retry: n, error: ctx.log.safe(e) }),
  });
  ctx.log({ phase: "upload", done: true, parts: parts.length });

  sync ??= await syncByDetection(ctx, cfg, take.match, sourcePath, src, fp);
  throwIfAborted(signal);

  const body: JobDoneBody = {
    parts,
    sizeBytes: copy.sizeBytes,
    durationSeconds: copy.probe.durationS,
    width: copy.probe.width,
    height: copy.probe.height,
    fps: copy.probe.fps > 0 ? copy.probe.fps : null,
    fingerprint: fp,
    sync,
  };
  const done = await client.done(take.attempt, body);
  ctx.progress.set("detect", 1);
  return done;
}

async function runJob(cfg: Config, ctx: JobContext): Promise<number> {
  if (!cfg.videoId || !cfg.fnUrl || !cfg.workerSecret) {
    ctx.log({ phase: "config", error: "VIDEO_ID, GAME_VIDEO_FN_URL and WORKER_SECRET are required" });
    return 1;
  }
  const client = new FunctionClient({ url: cfg.fnUrl, secret: cfg.workerSecret, videoId: cfg.videoId });

  let take: GameVideoJobTakeResponse;
  try {
    take = await client.take();
  } catch (e) {
    if (e instanceof FunctionError && e.token === "job_busy") {
      ctx.log({ phase: "take", result: "job_busy", note: "another converter holds this row" });
      return 0;
    }
    ctx.log({ phase: "take", error: ctx.log.safe(e) });
    return 1;
  }
  ctx.attempt = take.attempt;
  ctx.log.setAttempt(take.attempt);
  ctx.log({
    phase: "take",
    match: take.match.id,
    source_mb: Math.round(take.sourceSizeBytes / 1e6),
    part_mb: Math.round(take.partSize / 1e6),
    profixio: take.match.isProfixio,
    anchor: take.match.anchorKind ?? "none",
    anchor_time: take.match.anchorRealWorldTime !== null,
  });

  const alive = cfg.aliveUrl ? new AlivePinger(cfg.aliveUrl, take.attempt, ctx.log) : null;
  alive?.start();
  // Progress and heartbeat together, on the wire's interval, whatever phase the job is in.
  const heartbeat = setInterval(() => {
    ctx.progress.line({ heartbeat: true });
    client.progress(take.attempt, ctx.progress.value).catch((e: unknown) => {
      if (e instanceof StaleAttempt) {
        if (!ctx.abort.signal.aborted) ctx.abort.abort("stale_attempt");
        return;
      }
      ctx.log({ phase: "progress", error: ctx.log.safe(e) });
    });
  }, GAME_VIDEO_PROGRESS_INTERVAL_SECONDS * 1000);

  let reported = false;
  let code = 1;
  try {
    const done = await convert(cfg, ctx, client, take);
    reported = true;
    ctx.log({ phase: "done", status: done.status, sync_status: done.syncStatus });
    code = 0;
  } catch (e) {
    if (e instanceof StaleAttempt || (e instanceof Aborted && e.reason === "stale_attempt")) {
      ctx.log({ phase: "stale", note: "another attempt owns the row; stopping without a report" });
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
        if (re instanceof StaleAttempt) ctx.log({ phase: "stale", note: "another attempt took the row meanwhile" });
        else ctx.log({ phase: "failed", report_error: ctx.log.safe(re) });
      }
      code = sigterm ? SIGTERM_EXIT : 1;
    }
  } finally {
    clearInterval(heartbeat);
    alive?.stop();
    // Tells the Worker the function has heard from this run, so its onStop safety net stays quiet.
    if (reported) await alive?.ping(true);
  }
  return code;
}

// ── dry run ───────────────────────────────────────────────────────────────────

async function dryRun(cfg: Config, source: string, ctx: JobContext): Promise<number> {
  ctx.log({ phase: "dry_run", source: basename(source), work_dir: ctx.workDir, ffmpeg: FFMPEG === "ffmpeg" ? "PATH" : "FFMPEG env", supabase: cfg.supabaseSource });
  try {
    const src = await probeSource(source);
    ctx.log({ phase: "probe", duration_s: Math.round(src.durationS), width: src.width, height: src.height, fps: src.fps });
    const fp = await fingerprint(source, src);
    ctx.log({ phase: "fingerprint", hashes: fp.hashes.length, key: fp.key.slice(0, 12) });
    const match: GameVideoJobMatch = {
      id: "dry-run",
      title: basename(source),
      sourceGameId: null,
      leagueId: null,
      isProfixio: false,
      anchorKind: "tipoff",
      anchorRealWorldTime: new Date().toISOString(),
    };
    let sync = await syncBeforeEncode(ctx, cfg, match, fp);
    const copy = await encodeAndVerify(ctx, source, src);
    ctx.log({ phase: "upload", skipped: "dry_run" });
    sync ??= await syncByDetection(ctx, cfg, match, source, src, fp);
    const body: JobDoneBody = {
      parts: [],
      sizeBytes: copy.sizeBytes,
      durationSeconds: copy.probe.durationS,
      width: copy.probe.width,
      height: copy.probe.height,
      fps: copy.probe.fps > 0 ? copy.probe.fps : null,
      fingerprint: fp,
      sync,
    };
    ctx.log({ phase: "dry_run", result: "ok", copy: cfg.workDir ? copy.path : "removed with the temp dir", payload: "follows" });
    console.log(JSON.stringify({ action: "job_done", videoId: cfg.videoId, attempt: 0, ...body }, null, 2));
    return 0;
  } catch (e) {
    const { error, retryable } = classifyFailure(e);
    ctx.log({ phase: "dry_run", result: "failed", error, retryable, detail: ctx.log.safe(e) });
    return e instanceof Aborted && e.reason === "sigterm" ? SIGTERM_EXIT : 1;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const cfg = readConfig();
  const log = createLogger(cfg.videoId || "?", [cfg.workerSecret, cfg.anonKey, cfg.botPassword, cfg.aliveUrl]);
  const abort = new AbortController();
  const onSignal = (signal: NodeJS.Signals) => {
    if (abort.signal.aborted) return;
    log({ phase: "signal", signal });
    abort.abort("sigterm");
    setTimeout(() => process.exit(SIGTERM_EXIT), SIGTERM_GRACE_MS).unref();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  const ctx: JobContext = {
    videoId: cfg.videoId,
    attempt: 0,
    log,
    abort,
    workDir: cfg.workDir ?? (await mkdtemp(join(tmpdir(), "game-video-"))),
    progress: new Progress(log),
  };
  if (cfg.workDir) await mkdir(cfg.workDir, { recursive: true });
  const health = cfg.port ? startHealthServer(cfg.port, () => ({ videoId: ctx.videoId, attempt: ctx.attempt, phase: ctx.progress.phase, progress: ctx.progress.value }), log) : null;
  try {
    return cfg.dryRunSource ? await dryRun(cfg, cfg.dryRunSource, ctx) : await runJob(cfg, ctx);
  } finally {
    health?.close();
    if (!cfg.workDir) await rm(ctx.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().then(
  (code) => {
    // Let stdout drain and the sockets close on their own; force the exit if something lingers.
    process.exitCode = code;
    setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
  },
  (e) => {
    console.error(`[convert] crashed: ${redact(e instanceof Error ? e.message : String(e), [])}`);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), EXIT_GRACE_MS).unref();
  },
);
