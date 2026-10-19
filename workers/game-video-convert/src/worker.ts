/**
 * Cloud game videos: the Worker in front of the containers.
 *
 * The `game-video` function POSTs /convert {videoId} (header x-convert-secret)
 * once a browser upload has landed, and /render {jobId} once a web playlist's
 * clips need cutting. One Durable Object per job (id = the video id for a
 * conversion, `render:<jobId>` for a render) starts a container from this
 * directory's Dockerfile with the job's env and lets it run the program for
 * its kind: src/convert.ts (the image's entrypoint) or src/render.ts (an
 * entrypoint override). The container pings /alive/<videoId> or
 * /alive/render/<jobId> every five minutes so a healthy job never meets the
 * 20-minute inactivity stop, announces its attempt number on the way, and
 * says `final=1` once the function has heard from it. If the process dies
 * without reporting (out of memory, a crash before job_failed), onStop tells
 * the function with that attempt and the sweep schedules another one.
 * Nothing here touches R2 or Supabase directly: the function is the only broker.
 *
 * Secrets (wrangler secret put <name> [--env staging]): CONVERT_SECRET,
 * WORKER_SECRET, BOT_EMAIL, BOT_PASSWORD. Vars (wrangler.jsonc): SUPABASE_URL,
 * SUPABASE_ANON_KEY, GAME_VIDEO_FN_URL.
 */
import { Container, getContainer, type StopParams } from "@cloudflare/containers";

export interface Env {
  CONVERTER: DurableObjectNamespace<GameVideoConverter>;
  CONVERT_SECRET: string;
  WORKER_SECRET: string;
  BOT_EMAIL?: string;
  BOT_PASSWORD?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GAME_VIDEO_FN_URL: string;
}

export type JobKind = "convert" | "render";

const CONTAINER_PORT = 8080;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long begin waits for an orphaned container's stop to be processed before starting the next run. */
const STOP_WAIT_MS = 8000;
const STOP_POLL_MS = 250;
const JOB_KEY = "job";
/** The render program, in the image's own shape (the Dockerfile's ENTRYPOINT runs convert.ts). */
const RENDER_ENTRYPOINT = ["tini", "--", "node", "--import", "tsx", "src/render.ts"];

/** What the Durable Object remembers about its current run. */
interface JobRecord {
  kind: JobKind;
  /** The video id (convert) or the render job id (render). */
  id: string;
  /** Proves an /alive call comes from this run's container. */
  token: string;
  /** The attempt the container announced, once it has taken the job. */
  attempt: number | null;
  /** The function has heard job_done / job_failed (or render_done / render_failed) from this run. */
  reported: boolean;
  /** onStop has run for this record. */
  stopped: boolean;
  startedAt: number;
}

/** A record as stored before render jobs existed: `videoId`, no `kind`. */
interface LegacyJobRecord extends Omit<JobRecord, "kind" | "id"> {
  kind?: JobKind;
  id?: string;
  videoId?: string;
}

function normalize(stored: LegacyJobRecord | JobRecord | undefined): JobRecord | undefined {
  if (!stored) return undefined;
  const r = stored as LegacyJobRecord;
  return { ...r, kind: r.kind ?? "convert", id: r.id ?? r.videoId ?? "?" } as JobRecord;
}

/** The Durable Object id for a job: the video id itself for a conversion, prefixed for a render. */
function objectName(kind: JobKind, id: string): string {
  return kind === "convert" ? id : `render:${id}`;
}

function log(kind: JobKind, id: string, attempt: number | null | undefined, message: string): void {
  console.log(`[${kind} ${id} a${attempt ?? 0}] ${message}`);
}

/** Error text for the log: no URLs, bounded. */
function safe(e: unknown): string {
  return String(e instanceof Error ? e.message : e)
    .replace(/https?:\/\/\S+/g, "<url>")
    .slice(0, 300);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Constant-time comparison of a presented secret with the configured one. */
function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

/** job_failed / render_failed for a run that died without reporting; the sweep takes it from there. Never throws. */
async function reportContainerExit(env: Env, kind: JobKind, id: string, attempt: number, exitCode: number): Promise<void> {
  const body =
    kind === "convert"
      ? { action: "job_failed", videoId: id, attempt, error: `container_exit_${exitCode}`, retryable: true }
      : { action: "render_failed", jobId: id, attempt, error: `container_exit_${exitCode}`, retryable: true };
  try {
    const res = await fetch(`${env.GAME_VIDEO_FN_URL.replace(/\/+$/, "")}/game-video`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": env.WORKER_SECRET },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    log(kind, id, attempt, `${body.action} for the container exit → ${res.status} ${text.slice(0, 120)}`);
  } catch (e) {
    log(kind, id, attempt, `${body.action} for the container exit could not be sent: ${safe(e)}`);
  }
}

export class GameVideoConverter extends Container<Env> {
  defaultPort = CONTAINER_PORT;
  sleepAfter = "20m";
  enableInternet = true;

  /** Start the converter for `videoId`; `origin` is this Worker's URL, for the container's alive pings. */
  begin(videoId: string, origin: string): Promise<{ restarted: boolean }> {
    return this.beginJob("convert", videoId, origin);
  }

  /** Start the program for a job of `kind` on `id`: the converter for a video, the renderer for a render job. */
  async beginJob(kind: JobKind, id: string, origin: string): Promise<{ restarted: boolean }> {
    let restarted = false;
    const previous = normalize(await this.ctx.storage.get<JobRecord>(JOB_KEY));
    if (this.ctx.container?.running) {
      // Only the sweep starts a job whose container still runs, and it does so because that
      // attempt stopped reporting: the orphan's exit is not news to anyone, so it is not reported.
      if (previous) await this.ctx.storage.put<JobRecord>(JOB_KEY, { ...previous, reported: true });
      log(kind, id, previous?.attempt, "a container is still running for this job: destroying it before the new attempt");
      await this.destroy();
      await this.waitForStop();
      restarted = true;
    } else if (previous && !previous.stopped) {
      // The last run has exited but its onStop hasn't run yet: let it finish with its own record.
      await this.waitForStop();
    }
    const token = crypto.randomUUID();
    await this.ctx.storage.put<JobRecord>(JOB_KEY, { kind, id, token, attempt: null, reported: false, stopped: false, startedAt: Date.now() });
    const common = {
      GAME_VIDEO_FN_URL: this.env.GAME_VIDEO_FN_URL,
      WORKER_SECRET: this.env.WORKER_SECRET,
      PORT: String(CONTAINER_PORT),
    };
    if (kind === "convert") {
      const envVars: Record<string, string> = {
        ...common,
        VIDEO_ID: id,
        SUPABASE_URL: this.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: this.env.SUPABASE_ANON_KEY,
        ALIVE_URL: `${origin}/alive/${id}?token=${token}`,
      };
      if (this.env.BOT_EMAIL) envVars.BOT_EMAIL = this.env.BOT_EMAIL;
      if (this.env.BOT_PASSWORD) envVars.BOT_PASSWORD = this.env.BOT_PASSWORD;
      await this.start({ envVars });
    } else {
      const envVars: Record<string, string> = {
        ...common,
        RENDER_JOB_ID: id,
        ALIVE_URL: `${origin}/alive/render/${id}?token=${token}`,
      };
      await this.start({ envVars, entrypoint: RENDER_ENTRYPOINT });
    }
    log(kind, id, null, `container started${restarted ? " after destroying the previous one" : ""}`);
    return { restarted };
  }

  /** The container's heartbeat: renews the inactivity clock, records the attempt and whether the job has reported. */
  async alive(token: string, attempt: number | null, final: boolean): Promise<boolean> {
    const job = normalize(await this.ctx.storage.get<JobRecord>(JOB_KEY));
    if (!job || job.token !== token) return false;
    const next: JobRecord = { ...job, attempt: attempt ?? job.attempt, reported: job.reported || final };
    if (next.attempt !== job.attempt || next.reported !== job.reported) await this.ctx.storage.put<JobRecord>(JOB_KEY, next);
    this.renewActivityTimeout();
    return true;
  }

  override async onStop({ exitCode, reason }: StopParams): Promise<void> {
    const job = normalize(await this.ctx.storage.get<JobRecord>(JOB_KEY));
    log(job?.kind ?? "convert", job?.id ?? "?", job?.attempt, `container stopped exit=${exitCode} reason=${reason}${job?.reported ? " (reported)" : ""}`);
    if (job && !job.stopped) {
      // The run reported nothing before dying: its attempt is dead, and the function must hear so.
      if (exitCode !== 0 && !job.reported && job.attempt !== null) await reportContainerExit(this.env, job.kind, job.id, job.attempt, exitCode);
      await this.ctx.storage.put<JobRecord>(JOB_KEY, { ...job, stopped: true });
    }
  }

  /**
   * Wait until the library has processed the previous run's stop (its state settled and
   * onStop run against its own record), so the new record can't be marked stopped by it.
   * The alarm loop does that within moments of the exit; the wait is bounded all the same.
   */
  private async waitForStop(): Promise<void> {
    const deadline = Date.now() + STOP_WAIT_MS;
    while (Date.now() < deadline) {
      const job = await this.ctx.storage.get<JobRecord>(JOB_KEY);
      const state = await this.getState();
      const settled = !this.ctx.container?.running && (state.status === "stopped" || state.status === "stopped_with_code");
      if (settled && (!job || job.stopped)) return;
      await sleep(STOP_POLL_MS);
    }
    log("convert", "?", null, "the previous container's stop was not processed in time; starting anyway");
  }
}

/** `POST /convert {videoId}` and `POST /render {jobId}`: the id from the body, validated, lowercased. */
async function idFromBody(request: Request, field: "videoId" | "jobId"): Promise<string | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const id = (body as Record<string, unknown> | null)?.[field];
  if (typeof id !== "string" || !UUID_RE.test(id)) return json({ error: "invalid_request" }, 400);
  return id.toLowerCase();
}

async function startJob(env: Env, kind: JobKind, id: string, origin: string): Promise<Response> {
  try {
    const result = await getContainer(env.CONVERTER, objectName(kind, id)).beginJob(kind, id, origin);
    return json({ [kind === "convert" ? "videoId" : "jobId"]: id, started: true, restarted: result.restarted }, 202);
  } catch (e) {
    log(kind, id, null, `start failed: ${safe(e)}`);
    return json({ error: "start_failed" }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return json({ ok: true, service: "game-video-convert" });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    if (url.pathname === "/convert" || url.pathname === "/render") {
      if (!secretMatches(request.headers.get("x-convert-secret"), env.CONVERT_SECRET)) return json({ error: "bad_convert_secret" }, 401);
      const kind: JobKind = url.pathname === "/convert" ? "convert" : "render";
      const id = await idFromBody(request, kind === "convert" ? "videoId" : "jobId");
      if (id instanceof Response) return id;
      return startJob(env, kind, id, url.origin);
    }

    const alive = /^\/alive\/(render\/)?([0-9a-f-]{36})$/i.exec(url.pathname);
    if (alive) {
      const kind: JobKind = alive[1] ? "render" : "convert";
      const id = alive[2].toLowerCase();
      if (!UUID_RE.test(id)) return json({ error: "invalid_request" }, 400);
      const token = url.searchParams.get("token") ?? "";
      const attemptRaw = url.searchParams.get("attempt");
      const attempt = attemptRaw && /^\d{1,6}$/.test(attemptRaw) ? Number(attemptRaw) : null;
      const final = url.searchParams.get("final") === "1";
      const ok = await getContainer(env.CONVERTER, objectName(kind, id)).alive(token, attempt, final);
      return ok ? new Response(null, { status: 204 }) : json({ error: "forbidden" }, 403);
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
