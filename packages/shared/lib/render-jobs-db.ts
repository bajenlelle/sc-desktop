/**
 * Render jobs: the server's bookkeeping for cutting a playlist's clips into
 * their own files (kind `ship`) and, later, for exporting it (kind
 * `export`). Rows are written by the `game-video` function only; RLS lets
 * the owner read their own, so the web editor can follow a job it asked for
 * (migration 20261020100000_render_jobs.sql).
 *
 * Each function takes a SupabaseClient so this module is isomorphic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RenderJobKind, RenderJobStatus } from "./game-video-wire";
import { reportDbError } from "./report";

/** What a finished job reports (`render_jobs.result`). */
export interface RenderJobResult {
  shipped: number;
  failed: number;
  superseded: number;
  total: number;
  /** The clips that could not be cut, with the error each one hit. */
  failures: { matchId: string; eventId: number; error: string }[];
}

export interface RenderJobRow {
  id: string;
  kind: RenderJobKind;
  playlist_id: string;
  status: RenderJobStatus;
  /** 0..1 over the job's clips while it runs; null before it has reported. */
  progress: number | string | null;
  requeue: boolean | null;
  result: unknown;
  error: string | null;
  attempt: number | null;
  created_at: string;
  finished_at: string | null;
}

export interface RenderJob {
  id: string;
  kind: RenderJobKind;
  playlistId: string;
  status: RenderJobStatus;
  /** 0..1, held inside the range; 0 before the first report, 1 once done. */
  progress: number;
  /** A request landed while the job ran: a fresh job follows this one. */
  requeue: boolean;
  result: RenderJobResult | null;
  error: string | null;
  attempt: number;
  createdAt: string;
  finishedAt: string | null;
}

export const RENDER_JOB_SELECT =
  "id, kind, playlist_id, status, progress, requeue, result, error, attempt, created_at, finished_at";

function count(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** The result as the function writes it; null for anything else (a job that never ran, an older shape). */
export function parseRenderJobResult(value: unknown): RenderJobResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!("shipped" in v) && !("total" in v) && !("failed" in v)) return null;
  const failures = Array.isArray(v.failures)
    ? v.failures
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({
          matchId: String(f.matchId ?? ""),
          eventId: count(f.eventId),
          error: String(f.error ?? "unknown"),
        }))
    : [];
  return {
    shipped: count(v.shipped),
    failed: count(v.failed),
    superseded: count(v.superseded),
    total: count(v.total),
    failures,
  };
}

export function rowToRenderJob(row: RenderJobRow): RenderJob {
  const raw = typeof row.progress === "string" ? Number(row.progress) : row.progress;
  const progress =
    row.status === "done" ? 1 : typeof raw === "number" && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  return {
    id: row.id,
    kind: row.kind,
    playlistId: row.playlist_id,
    status: row.status,
    progress,
    requeue: row.requeue === true,
    result: parseRenderJobResult(row.result),
    error: row.error ?? null,
    attempt: row.attempt ?? 0,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  };
}

/** True while the job can still change: it waits for a renderer or one is working on it. */
export function isRenderJobLive(status: RenderJobStatus): boolean {
  return status === "queued" || status === "running";
}

/**
 * The job's progress in clips, for a "3 of 8" readout. `total` comes from
 * the ship response that started the job; the finished result carries its
 * own count and wins once it is there.
 */
export function renderJobCounts(job: RenderJob | null, total: number): { done: number; total: number; failed: number } {
  if (!job) return { done: 0, total, failed: 0 };
  if (job.result) {
    const t = job.result.total || total;
    return { done: Math.min(t, job.result.shipped + job.result.failed + job.result.superseded), total: t, failed: job.result.failed };
  }
  return { done: Math.min(total, Math.round(job.progress * total)), total, failed: 0 };
}

/** One job by id, as the owner sees it; null when it is gone or not theirs. */
export async function getRenderJob(supabase: SupabaseClient, jobId: string): Promise<RenderJob | null> {
  const { data, error } = await supabase.from("render_jobs").select(RENDER_JOB_SELECT).eq("id", jobId).maybeSingle();
  if (error) {
    reportDbError("getRenderJob", error);
    return null;
  }
  return data ? rowToRenderJob(data as unknown as RenderJobRow) : null;
}

/**
 * The playlist's job of `kind` that is still queued or running (the index
 * allows one per playlist, kind and aspect), newest first; null when none is.
 */
export async function getLiveRenderJob(
  supabase: SupabaseClient,
  playlistId: string,
  kind: RenderJobKind,
): Promise<RenderJob | null> {
  const { data, error } = await supabase
    .from("render_jobs")
    .select(RENDER_JOB_SELECT)
    .eq("playlist_id", playlistId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    reportDbError("getLiveRenderJob", error);
    return null;
  }
  return data ? rowToRenderJob(data as unknown as RenderJobRow) : null;
}
