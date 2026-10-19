// Scoutable — cloud game videos Edge Function: the render jobs' bookkeeping,
// shared by both kinds (render.ts cuts a web playlist's clips, export.ts
// makes one MP4 of a playlist): the row and its reads and writes, starting a
// renderer within the caps, the claim render_take makes, and the fence every
// later renderer call passes (the attempt it was given, and the owner's
// cancel).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  MAX_ACTIVE_RENDERS,
  RENDER_MAX_ATTEMPTS,
  type RenderJobKind,
  type RenderJobStatus,
  type RenderPhase,
} from "../../../packages/shared/lib/game-video-wire.ts";
import { CONVERT_SECRET, CONVERT_URL, STALE_MS, UUID_RE, err, optInt, optString, type Payload } from "./common.ts";

export interface RenderJobRow {
  id: string;
  kind: RenderJobKind;
  playlist_id: string;
  user_id: string;
  org_id: string | null;
  status: RenderJobStatus;
  /** Exports: where the renderer is (migration 20261021100000). */
  phase: RenderPhase | null;
  requeue: boolean;
  attempt: number;
  heartbeat_at: string | null;
  progress: number | null;
  request: Record<string, unknown> | null;
  params: unknown;
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export const JOB_SELECT =
  "id, kind, playlist_id, user_id, org_id, status, phase, requeue, attempt, heartbeat_at, progress, request, params, result, error, created_at, updated_at, finished_at";

/** The error a job the owner stopped carries (render_cancel); the renderer's later calls are answered with it. */
export const CANCELLED = "cancelled";

export function isCancelled(job: Pick<RenderJobRow, "status" | "error">): boolean {
  return job.status === "failed" && job.error === CANCELLED;
}

export async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return (data ?? []) as T[];
}

export async function loadJob(admin: SupabaseClient, jobId: string): Promise<RenderJobRow | null> {
  if (!UUID_RE.test(jobId)) return null;
  const { data, error } = await admin.from("render_jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return (data as unknown as RenderJobRow | null) ?? null;
}

export async function updateJob(admin: SupabaseClient, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("render_jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`lookup_failed ${error.message}`);
}

export async function finishJob(admin: SupabaseClient, jobId: string, status: "done" | "failed", error: string | null, result: unknown = null): Promise<void> {
  await updateJob(admin, jobId, {
    status,
    error,
    result,
    progress: status === "done" ? 1 : null,
    heartbeat_at: null,
    requeue: false,
    finished_at: new Date().toISOString(),
  });
}

/**
 * The playlist's live job of a kind (one at most per aspect and purpose, by
 * the live index); for an export, the one of that aspect and purpose.
 */
export async function liveJob(
  admin: SupabaseClient,
  playlistId: string,
  kind: RenderJobKind,
  request?: { aspect: string; purpose: string },
): Promise<RenderJobRow | null> {
  let q = admin.from("render_jobs").select(JOB_SELECT).eq("playlist_id", playlistId).eq("kind", kind).in("status", ["queued", "running"]);
  if (request) q = q.eq("request->>aspect", request.aspect).eq("request->>purpose", request.purpose);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return ((data ?? []) as unknown as RenderJobRow[])[0] ?? null;
}

/** The kill switch every cloud-video action honours. */
export async function cloudVideoEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("app_config").select("value").eq("key", "cloud_video_enabled").maybeSingle();
  return (data as { value?: string } | null)?.value !== "false";
}

// ---------------------------------------------------------------------------
// Starting a renderer
// ---------------------------------------------------------------------------

/**
 * Asks the Worker to run a queued job, unless the owner already has a live
 * render or the fleet is busy; the job then waits (heartbeat NULL) for the
 * sweep. With no converter configured, or one that can't be reached, the job
 * waits the same way: the sweep retries, and a job nobody took for a day
 * fails renderer_unavailable. Bounded to ten seconds, never throws.
 */
export async function startRender(admin: SupabaseClient, job: RenderJobRow): Promise<"started" | "waiting" | "unavailable"> {
  if (!CONVERT_URL || !CONVERT_SECRET) return "unavailable";
  const since = new Date(Date.now() - STALE_MS).toISOString();
  const { count: mine } = await admin
    .from("render_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", job.user_id)
    .eq("status", "running")
    .neq("id", job.id)
    .gt("heartbeat_at", since);
  if ((mine ?? 0) > 0) return "waiting";
  const { count: active } = await admin.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", "running").gt("heartbeat_at", since);
  if ((active ?? 0) >= MAX_ACTIVE_RENDERS) return "waiting";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${CONVERT_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-convert-secret": CONVERT_SECRET },
      body: JSON.stringify({ jobId: job.id }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[game-video] the renderer refused to start:", res.status, (await res.text()).slice(0, 200));
      return "waiting";
    }
    return "started";
  } catch (e) {
    console.error("[game-video] the renderer could not be reached:", e instanceof Error ? e.message : String(e));
    return "waiting";
  } finally {
    clearTimeout(timer);
  }
}

/** After one of the owner's renders ends, their next waiting job may go. */
export async function startNextWaitingRender(admin: SupabaseClient, userId: string): Promise<void> {
  const { data } = await admin
    .from("render_jobs")
    .select(JOB_SELECT)
    .eq("user_id", userId)
    .eq("status", "queued")
    .is("heartbeat_at", null)
    .order("created_at", { ascending: true })
    .limit(1);
  const next = ((data ?? []) as unknown as RenderJobRow[])[0];
  if (next) await startRender(admin, next);
}

// ---------------------------------------------------------------------------
// The renderer's calls
// ---------------------------------------------------------------------------

/**
 * render_take's claim, for either kind: a queued job, or a running one whose
 * renderer went quiet; whoever moves the attempt counter first holds it. A
 * job past its attempts fails gave_up. Answers the attempt, or the response
 * that ends the call.
 */
export async function claimJob(admin: SupabaseClient, job: RenderJobRow): Promise<{ attempt: number } | Response> {
  if (job.status !== "queued" && job.status !== "running") return err(409, "wrong_status");
  if (job.status === "running" && job.heartbeat_at && Date.parse(job.heartbeat_at) > Date.now() - STALE_MS) return err(409, "job_busy");
  const attempt = job.attempt + 1;
  if (attempt > RENDER_MAX_ATTEMPTS) {
    await finishJob(admin, job.id, "failed", "gave_up");
    return err(409, "wrong_status");
  }
  const { data: claimed, error: claimError } = await admin
    .from("render_jobs")
    .update({ status: "running", attempt, heartbeat_at: new Date().toISOString(), progress: 0, phase: null, error: null })
    .eq("id", job.id)
    .eq("attempt", job.attempt)
    .in("status", ["queued", "running"])
    .select("id");
  if (claimError) return err(500, "lookup_failed");
  if (!claimed || claimed.length === 0) return err(409, "job_busy");
  return { attempt };
}

/**
 * The job for a later renderer call, or the response that ends it: not
 * found, stopped by its owner (409 cancelled: the renderer stops and cleans
 * up), or another attempt's.
 */
export async function fencedRender(admin: SupabaseClient, p: Payload): Promise<{ job: RenderJobRow; attempt: number } | Response> {
  const jobId = optString(p.jobId, 36);
  const attempt = optInt(p.attempt);
  if (!jobId || !UUID_RE.test(jobId) || attempt === null) return err(400, "invalid_request");
  const job = await loadJob(admin, jobId);
  if (!job) return err(404, "not_found");
  if (isCancelled(job)) return err(409, CANCELLED);
  if (job.attempt !== attempt) return err(409, "stale_attempt");
  return { job, attempt };
}

/**
 * Why a fenced write found no running row of its attempt: the owner's cancel
 * or another attempt that took the job meanwhile.
 */
export async function lostRace(admin: SupabaseClient, jobId: string, attempt: number): Promise<Response> {
  const now = await loadJob(admin, jobId);
  if (!now) return err(404, "not_found");
  if (isCancelled(now)) return err(409, CANCELLED);
  return err(409, now.attempt !== attempt ? "stale_attempt" : "wrong_status");
}
