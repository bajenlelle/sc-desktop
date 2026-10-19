// Scoutable — cloud game videos Edge Function: render jobs.
// A playlist built on the web has clips without files. When it is shared, the
// owner asks for its clips to be cut from their cloud copies into files in
// the PUBLIC media bucket under the desktop's key scheme (clipShipKey), so
// players, mobile and the desktop see nothing new. A `render_jobs` row carries
// each run with the conversions' bookkeeping; the plan (which clips, their
// windows, their keys) is computed here from the rows with the shared
// clip-ship-plan helpers, previewed at `ship` and recomputed at `render_take`
// so edits made while a job waited are picked up, and checked again at
// `render_done` so a clip trimmed meanwhile is never recorded (superseded)
// but cut again by the follow-up job.
//
//   ship            (the owner) plan preview + a queued job, or the live one
//   render_take     (the renderer, x-worker-secret) claim the job: presigned
//                   copy GETs and media PUTs for the current plan
//   render_progress fenced heartbeat + progress
//   render_done     fenced, idempotent: r2_url per clip whose key still
//                   matches, notify pending shares, requeue, next waiting
//   render_failed   fenced: queued again (the sweep retries) or failed
//   sweep           waiting jobs get a renderer; quiet ones are re-run; a job
//                   nobody took for a day fails renderer_unavailable
//   sync_set        the uploader's shipped clips of the game follow the new
//                   sync: legacy keys cleared, stale ones re-shipped when shared

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  MAX_ACTIVE_RENDERS,
  RENDER_MAX_ATTEMPTS,
  RENDER_URL_SECONDS,
  type GameVideoSweepResponse,
  type RenderClipResult,
  type RenderJobKind,
  type RenderJobStatus,
  type RenderShipClip,
  type ShipNoCopy,
  type ShipResponse,
  type ShipSkipped,
} from "../../../packages/shared/lib/game-video-wire.ts";
import {
  clipBounds,
  clipShipKey,
  computeVideoTime,
  isShippedClipStale,
  playlistRolls,
  shippedStart,
  type SyncPointLike,
} from "../../../packages/shared/lib/clip-ship-plan.ts";
import {
  CONVERT_SECRET,
  CONVERT_URL,
  MEDIA_PUBLIC_URL,
  STALE_MS,
  SWEEP_BATCH,
  UUID_RE,
  err,
  guardKey,
  mediaConfigured,
  objectUrl,
  ok,
  optInt,
  optNumber,
  optString,
  presign,
  presignMediaPut,
  type Payload,
} from "./common.ts";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface RenderJobRow {
  id: string;
  kind: RenderJobKind;
  playlist_id: string;
  user_id: string;
  org_id: string | null;
  status: RenderJobStatus;
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

const JOB_SELECT = "id, kind, playlist_id, user_id, org_id, status, requeue, attempt, heartbeat_at, progress, request, params, result, error, created_at, updated_at, finished_at";

/** What a done job records (render_jobs.result). */
interface RenderResult {
  shipped: number;
  failed: number;
  superseded: number;
  total: number;
  failures: { matchId: string; eventId: number; error: string }[];
}

const EMPTY_RESULT: RenderResult = { shipped: 0, failed: 0, superseded: 0, total: 0, failures: [] };

async function loadJob(admin: SupabaseClient, jobId: string): Promise<RenderJobRow | null> {
  if (!UUID_RE.test(jobId)) return null;
  const { data, error } = await admin.from("render_jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return (data as unknown as RenderJobRow | null) ?? null;
}

async function updateJob(admin: SupabaseClient, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("render_jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`lookup_failed ${error.message}`);
}

async function finishJob(admin: SupabaseClient, jobId: string, status: "done" | "failed", error: string | null, result: RenderResult | null = null): Promise<void> {
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

/** The playlist's live job of a kind (one at most, by the live index). */
async function liveJob(admin: SupabaseClient, playlistId: string, kind: RenderJobKind): Promise<RenderJobRow | null> {
  const { data, error } = await admin
    .from("render_jobs")
    .select(JOB_SELECT)
    .eq("playlist_id", playlistId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return ((data ?? []) as unknown as RenderJobRow[])[0] ?? null;
}

/** The kill switch every cloud-video action honours. */
async function cloudVideoEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("app_config").select("value").eq("key", "cloud_video_enabled").maybeSingle();
  return (data as { value?: string } | null)?.value !== "false";
}

// ---------------------------------------------------------------------------
// The plan: which clips to cut, from the current rows
// ---------------------------------------------------------------------------

interface PlaylistRow {
  id: string;
  user_id: string;
  org_id: string | null;
  pre_roll: number | null;
  post_roll: number | null;
}

interface ClipRow {
  id: number;
  match_id: string;
  event_id: number;
  pre_roll_offset: number | string | null;
  post_roll_offset: number | string | null;
  r2_url: string | null;
}

interface MatchRow {
  id: string;
  user_id: string;
  org_id: string | null;
  sync_point: SyncPointLike | null;
  is_demo: boolean | null;
}

/** One clip the job cuts: its window in the copy and the public key its file goes under. */
interface PlanClip {
  clipId: string;
  matchId: string;
  eventId: number;
  videoId: string;
  storageKey: string;
  start: number;
  end: number;
  key: string;
}

interface ShipPlan {
  playlist: PlaylistRow;
  clips: PlanClip[];
  skipped: ShipSkipped[];
  noCopy: ShipNoCopy[];
  /** The key every clip with a time would be stored under now (`matchId:eventId` → key), shipped or not. */
  expectedKeys: Map<string, string>;
  /** A clip of the sample game: never cut, never shared. */
  demo: boolean;
}

const clipRef = (matchId: string, eventId: number) => `${matchId}:${eventId}`;

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return (data ?? []) as T[];
}

/**
 * The playlist's clips as they stand: `t = computeVideoTime(event, sync)`
 * (null → skipped no_time), the window from the playlist's pair and the
 * clip's offsets, the key from the effective totals and the start. A clip
 * whose r2_url already ends with that key is up to date. The copy is usable
 * when a ready game_videos row exists for the match and the owner is the
 * match's owner or an admin/coach of its org (presign-upload's rule); else
 * the clip is reported under noCopy. Null when the playlist doesn't exist.
 */
export async function buildShipPlan(admin: SupabaseClient, playlistId: string): Promise<ShipPlan | null> {
  const { data: playlistData, error: playlistError } = await admin
    .from("playlists")
    .select("id, user_id, org_id, pre_roll, post_roll")
    .eq("id", playlistId)
    .maybeSingle();
  if (playlistError) throw new Error(`lookup_failed ${playlistError.message}`);
  const playlist = playlistData as unknown as PlaylistRow | null;
  if (!playlist) return null;

  const plan: ShipPlan = { playlist, clips: [], skipped: [], noCopy: [], expectedKeys: new Map(), demo: false };
  const clips = await rows<ClipRow>(
    admin
      .from("playlist_clips")
      .select("id, match_id, event_id, pre_roll_offset, post_roll_offset, r2_url")
      .eq("playlist_id", playlistId)
      .eq("item_type", "clip")
      .not("match_id", "is", null)
      .not("event_id", "is", null)
      .order("position", { ascending: true }),
  );
  if (clips.length === 0) return plan;

  const matchIds = [...new Set(clips.map((c) => c.match_id))];
  const eventIds = [...new Set(clips.map((c) => c.event_id))];
  const [matches, events, videos] = await Promise.all([
    rows<MatchRow>(admin.from("matches").select("id, user_id, org_id, sync_point, is_demo").in("id", matchIds)),
    rows<{ match_id: string; event_id: number; period: number | null; real_world_time: string | null }>(
      admin.from("play_by_play_events").select("match_id, event_id, period, real_world_time").in("match_id", matchIds).in("event_id", eventIds),
    ),
    rows<{ id: string; match_id: string; storage_key: string }>(
      admin.from("game_videos").select("id, match_id, storage_key").in("match_id", matchIds).eq("status", "ready"),
    ),
  ]);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const eventByRef = new Map(events.map((e) => [clipRef(e.match_id, e.event_id), e]));
  const videoByMatch = new Map(videos.map((v) => [v.match_id, v]));

  // The org rule, looked up once: the owner's staff memberships in the orgs of matches they don't own.
  const foreignOrgs = [...new Set(matches.filter((m) => m.user_id !== playlist.user_id && m.org_id).map((m) => m.org_id as string))];
  const staffOrgs = new Set<string>();
  if (foreignOrgs.length > 0) {
    const memberships = await rows<{ org_id: string; role: string }>(
      admin.from("org_memberships").select("org_id, role").eq("user_id", playlist.user_id).in("org_id", foreignOrgs),
    );
    for (const m of memberships) if (m.role === "admin" || m.role === "coach") staffOrgs.add(m.org_id);
  }

  const pair = playlistRolls({ preRoll: playlist.pre_roll, postRoll: playlist.post_roll });
  const noCopyByMatch = new Map<string, ShipNoCopy>();
  for (const clip of clips) {
    const match = matchById.get(clip.match_id);
    if (match?.is_demo) plan.demo = true;
    const event = eventByRef.get(clipRef(clip.match_id, clip.event_id));
    const sync = match?.sync_point ?? null;
    const t = match && event && sync && typeof sync.syncVideoTime === "number" ? computeVideoTime({ realWorldTime: event.real_world_time, period: event.period }, sync) : null;
    if (t === null) {
      plan.skipped.push({ matchId: clip.match_id, eventId: clip.event_id, reason: "no_time" });
      continue;
    }
    const preOff = Number(clip.pre_roll_offset ?? 0) || 0;
    const postOff = Number(clip.post_roll_offset ?? 0) || 0;
    const { start, end } = clipBounds(t, pair.pre, pair.post, preOff, postOff);
    const key = clipShipKey(clip.match_id, clip.event_id, pair.pre + preOff, pair.post + postOff, start);
    plan.expectedKeys.set(clipRef(clip.match_id, clip.event_id), key);
    if (clip.r2_url && clip.r2_url.endsWith(`/${key}`)) {
      plan.skipped.push({ matchId: clip.match_id, eventId: clip.event_id, reason: "up_to_date" });
      continue;
    }
    const video = videoByMatch.get(clip.match_id);
    const usable = !!video && !!match && (match.user_id === playlist.user_id || (!!match.org_id && staffOrgs.has(match.org_id)));
    if (!usable) {
      const entry = noCopyByMatch.get(clip.match_id) ?? { matchId: clip.match_id, eventIds: [] };
      entry.eventIds.push(clip.event_id);
      noCopyByMatch.set(clip.match_id, entry);
      continue;
    }
    plan.clips.push({ clipId: String(clip.id), matchId: clip.match_id, eventId: clip.event_id, videoId: video.id, storageKey: video.storage_key, start, end, key });
  }
  plan.noCopy = [...noCopyByMatch.values()];
  return plan;
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
async function startRender(admin: SupabaseClient, job: RenderJobRow): Promise<"started" | "waiting" | "unavailable"> {
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
async function startNextWaitingRender(admin: SupabaseClient, userId: string): Promise<void> {
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
// Queueing a ship
// ---------------------------------------------------------------------------

/** Pending shares get their notice once files exist; never fails the caller. */
async function notifyPendingShares(admin: SupabaseClient, playlistId: string): Promise<void> {
  const { error } = await admin.rpc("_notify_pending_shares_for_playlist", { p_playlist_id: playlistId });
  if (error) console.error("[game-video] notifying pending shares failed:", error.message);
}

/**
 * A ship job for the plan: the live job when there is one (a queued job is
 * returned as is; a running one will run again afterwards), a done job for
 * an empty plan (so the web has something to read), else a queued job and a
 * renderer for it. Two requests racing on the live index both land on the one
 * row that won.
 */
async function enqueueShip(admin: SupabaseClient, plan: ShipPlan): Promise<ShipResponse> {
  const { playlist } = plan;
  const total = plan.clips.length;
  const preview = { total, skipped: plan.skipped, noCopy: plan.noCopy };

  const coalesce = async (live: RenderJobRow): Promise<ShipResponse> => {
    const requeued = live.status === "running";
    if (requeued && !live.requeue) await updateJob(admin, live.id, { requeue: true });
    return { jobId: live.id, status: live.status, ...preview, requeued };
  };
  const live = await liveJob(admin, playlist.id, "ship");
  if (live) return coalesce(live);

  if (total === 0) {
    const { data, error } = await admin
      .from("render_jobs")
      .insert({ kind: "ship", playlist_id: playlist.id, user_id: playlist.user_id, org_id: playlist.org_id, status: "done", progress: 1, result: EMPTY_RESULT, finished_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) throw new Error(`lookup_failed ${error.message}`);
    // Shares added after the last ship landed are notified at insert; this covers one that slipped between.
    await notifyPendingShares(admin, playlist.id);
    return { jobId: (data as { id: string }).id, status: "done", ...preview, requeued: false };
  }

  const { data, error } = await admin
    .from("render_jobs")
    .insert({ kind: "ship", playlist_id: playlist.id, user_id: playlist.user_id, org_id: playlist.org_id, status: "queued", request: {} })
    .select(JOB_SELECT)
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await liveJob(admin, playlist.id, "ship");
      if (again) return coalesce(again);
    }
    throw new Error(`lookup_failed ${error.message}`);
  }
  const job = data as unknown as RenderJobRow;
  await startRender(admin, job);
  return { jobId: job.id, status: "queued", ...preview, requeued: false };
}

// ---------------------------------------------------------------------------
// Action: the owner
// ---------------------------------------------------------------------------

export async function ship(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const playlistId = optString(p.playlistId, 36);
  if (!playlistId || !UUID_RE.test(playlistId)) return err(400, "invalid_request");
  if (!(await cloudVideoEnabled(admin))) return err(503, "feature_disabled");
  if (!mediaConfigured()) return err(503, "renderer_unavailable");
  const plan = await buildShipPlan(admin, playlistId);
  // 403 also for a playlist that doesn't exist, so nothing leaks.
  if (!plan || plan.playlist.user_id !== userId) return err(403, "not_owner");
  if (plan.demo) return err(400, "demo_game");
  return ok(await enqueueShip(admin, plan));
}

// ---------------------------------------------------------------------------
// Actions: the renderer (every write fenced by the attempt it was given)
// ---------------------------------------------------------------------------

/** The job for a renderer call, or the response that ends it: not found, or another attempt's. */
async function fencedRender(admin: SupabaseClient, p: Payload): Promise<{ job: RenderJobRow; attempt: number } | Response> {
  const jobId = optString(p.jobId, 36);
  const attempt = optInt(p.attempt);
  if (!jobId || !UUID_RE.test(jobId) || attempt === null) return err(400, "invalid_request");
  const job = await loadJob(admin, jobId);
  if (!job) return err(404, "not_found");
  if (job.attempt !== attempt) return err(409, "stale_attempt");
  return { job, attempt };
}

export async function renderTake(admin: SupabaseClient, p: Payload): Promise<Response> {
  const jobId = optString(p.jobId, 36);
  if (!jobId || !UUID_RE.test(jobId)) return err(400, "invalid_request");
  if (!mediaConfigured()) return err(503, "renderer_unavailable");
  const job = await loadJob(admin, jobId);
  if (!job) return err(404, "not_found");
  if (job.kind !== "ship" || (job.status !== "queued" && job.status !== "running")) return err(409, "wrong_status");
  if (job.status === "running" && job.heartbeat_at && Date.parse(job.heartbeat_at) > Date.now() - STALE_MS) return err(409, "job_busy");
  const attempt = job.attempt + 1;
  if (attempt > RENDER_MAX_ATTEMPTS) {
    await finishJob(admin, job.id, "failed", "gave_up");
    return err(409, "wrong_status");
  }

  // The claim: whoever moves the attempt counter first holds the job.
  const { data: claimed, error: claimError } = await admin
    .from("render_jobs")
    .update({ status: "running", attempt, heartbeat_at: new Date().toISOString(), progress: 0, error: null })
    .eq("id", job.id)
    .eq("attempt", job.attempt)
    .in("status", ["queued", "running"])
    .select("id");
  if (claimError) return err(500, "lookup_failed");
  if (!claimed || claimed.length === 0) return err(409, "job_busy");

  // The plan as the rows stand now: edits made while the job waited are in.
  const plan = await buildShipPlan(admin, job.playlist_id);
  if (!plan) {
    await finishJob(admin, job.id, "failed", "not_found");
    return err(404, "not_found");
  }
  if (plan.demo) {
    await finishJob(admin, job.id, "failed", "demo_game");
    return err(409, "wrong_status");
  }

  const copies: Record<string, { url: string }> = {};
  for (const clip of plan.clips) {
    if (copies[clip.videoId]) continue;
    guardKey(clip.storageKey);
    copies[clip.videoId] = { url: await presign("GET", objectUrl(clip.storageKey), RENDER_URL_SECONDS) };
  }
  const clips: RenderShipClip[] = [];
  for (const clip of plan.clips) {
    const putUrl = await presignMediaPut(clip.key, "video/mp4", RENDER_URL_SECONDS);
    clips.push({ clipId: clip.clipId, matchId: clip.matchId, eventId: clip.eventId, videoId: clip.videoId, start: clip.start, end: clip.end, key: clip.key, putUrl });
  }
  await updateJob(admin, job.id, {
    params: { total: clips.length, clips: plan.clips.map(({ clipId, matchId, eventId, videoId, start, end, key }) => ({ clipId, matchId, eventId, videoId, start, end, key })) },
  });
  return ok({ jobId: job.id, attempt, kind: job.kind, copies, clips, publicBase: MEDIA_PUBLIC_URL });
}

export async function renderProgress(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fencedRender(admin, p);
  if (f instanceof Response) return f;
  if (f.job.status !== "running") return err(409, "wrong_status");
  const progress = optNumber(p.progress);
  if (progress === null) return err(400, "invalid_request");
  await updateJob(admin, f.job.id, { progress: Math.min(0.99, Math.max(0, progress)), heartbeat_at: new Date().toISOString() });
  return ok({ jobId: f.job.id, attempt: f.attempt });
}

function resultsOf(v: unknown): RenderClipResult[] | null {
  if (!Array.isArray(v)) return null;
  const out: RenderClipResult[] = [];
  for (const raw of v as unknown[]) {
    const r = raw as { matchId?: unknown; eventId?: unknown; key?: unknown; ok?: unknown; error?: unknown };
    if (typeof r.matchId !== "string" || typeof r.eventId !== "number" || typeof r.key !== "string" || typeof r.ok !== "boolean") return null;
    out.push({ matchId: r.matchId, eventId: r.eventId, key: r.key, ok: r.ok, ...(typeof r.error === "string" ? { error: r.error.slice(0, 200) } : {}) });
  }
  return out;
}

function countsOf(result: unknown): Pick<RenderResult, "shipped" | "failed" | "superseded"> {
  const r = (result ?? {}) as Partial<RenderResult>;
  return { shipped: r.shipped ?? 0, failed: r.failed ?? 0, superseded: r.superseded ?? 0 };
}

export async function renderDone(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fencedRender(admin, p);
  if (f instanceof Response) return f;
  const { job } = f;
  if (job.status === "done") return ok({ jobId: job.id, status: "done", ...countsOf(job.result) }); // a retried done
  if (job.status !== "running") return err(409, "wrong_status");
  const results = resultsOf(p.results);
  if (!results) return err(400, "invalid_request");
  if (!mediaConfigured()) return err(503, "renderer_unavailable");

  // Only a key this function derives from the rows as they stand now is ever
  // written: a clip trimmed, re-rolled or re-synced while the job ran is
  // superseded (its file sits unused) and the follow-up job cuts it again.
  const plan = await buildShipPlan(admin, job.playlist_id);
  if (!plan) return err(404, "not_found");
  const result: RenderResult = { ...EMPTY_RESULT, total: results.length, failures: [] };
  for (const r of results) {
    if (!r.ok) {
      result.failed++;
      result.failures.push({ matchId: r.matchId, eventId: r.eventId, error: r.error ?? "failed" });
      continue;
    }
    if (plan.expectedKeys.get(clipRef(r.matchId, r.eventId)) !== r.key) {
      result.superseded++;
      continue;
    }
    const { error } = await admin
      .from("playlist_clips")
      .update({ r2_url: `${MEDIA_PUBLIC_URL}/${r.key}` })
      .eq("playlist_id", job.playlist_id)
      .eq("match_id", r.matchId)
      .eq("event_id", r.eventId)
      .eq("item_type", "clip");
    if (error) throw new Error(`lookup_failed ${error.message}`);
    result.shipped++;
  }

  await notifyPendingShares(admin, job.playlist_id);
  await finishJob(admin, job.id, "done", null, result);

  // The playlist changed while this ran (requeue), or a cut landed on a changed clip: once more, from the rows now.
  if (job.requeue || result.superseded > 0) {
    const again = await buildShipPlan(admin, job.playlist_id);
    if (again && !again.demo && again.clips.length > 0) await enqueueShip(admin, again);
  }
  await startNextWaitingRender(admin, job.user_id);
  return ok({ jobId: job.id, status: "done", shipped: result.shipped, failed: result.failed, superseded: result.superseded });
}

export async function renderFailed(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fencedRender(admin, p);
  if (f instanceof Response) return f;
  const { job, attempt } = f;
  if (job.status !== "running") return ok({ jobId: job.id, status: job.status, attempt }); // already settled
  const error = optString(p.error, 64) ?? "unknown";
  const retryable = p.retryable !== false;
  if (retryable && attempt < RENDER_MAX_ATTEMPTS) {
    // Handed back for the sweep to run again.
    await updateJob(admin, job.id, { status: "queued", heartbeat_at: null, progress: null, error });
    return ok({ jobId: job.id, status: "queued", attempt });
  }
  await finishJob(admin, job.id, "failed", retryable ? "gave_up" : error);
  await startNextWaitingRender(admin, job.user_id);
  return ok({ jobId: job.id, status: "failed", attempt });
}

// ---------------------------------------------------------------------------
// The sweep's render duties
// ---------------------------------------------------------------------------

/**
 * Jobs waiting for a renderer get one; running jobs whose renderer went
 * quiet are queued again and re-run, or fail for good after three attempts;
 * a job nobody ever took within a day fails renderer_unavailable.
 */
export async function sweepRenders(admin: SupabaseClient, result: GameVideoSweepResponse): Promise<void> {
  const now = Date.now();
  const since = new Date(now - STALE_MS).toISOString();
  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  const { data } = await admin
    .from("render_jobs")
    .select(JOB_SELECT)
    .in("status", ["queued", "running"])
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${since}`)
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH);
  for (const job of (data ?? []) as unknown as RenderJobRow[]) {
    result.examined++;
    const stale = job.status === "running";
    if (job.attempt >= RENDER_MAX_ATTEMPTS) {
      await finishJob(admin, job.id, "failed", "gave_up");
      result.failed++;
      continue;
    }
    if (!stale && job.attempt === 0 && job.created_at < dayAgo) {
      await finishJob(admin, job.id, "failed", "renderer_unavailable");
      result.failed++;
      continue;
    }
    if (stale) await updateJob(admin, job.id, { status: "queued", heartbeat_at: null, progress: null });
    if ((await startRender(admin, job)) === "started") result.started++;
  }
}

// ---------------------------------------------------------------------------
// After a sync change on the web
// ---------------------------------------------------------------------------

/**
 * The uploader's own playlists' shipped clips of the game follow its new
 * sync, as the desktop's afterSyncChange does: files from before keys carried
 * a start can't be compared and stop being served; files whose window moved
 * are cut again for the playlists anyone else watches (the owner plays
 * windows). Players keep the old cut until the new file lands.
 */
export async function invalidateShippedClipsAfterSync(admin: SupabaseClient, matchId: string, userId: string): Promise<void> {
  interface OwnClipRow {
    id: number;
    playlist_id: string;
    event_id: number;
    pre_roll_offset: number | string | null;
    post_roll_offset: number | string | null;
    r2_url: string;
    playlists: { id: string; user_id: string; pre_roll: number | null; post_roll: number | null } | null;
  }
  const clips = await rows<OwnClipRow>(
    admin
      .from("playlist_clips")
      .select("id, playlist_id, event_id, pre_roll_offset, post_roll_offset, r2_url, playlists!inner(id, user_id, pre_roll, post_roll)")
      .eq("match_id", matchId)
      .eq("item_type", "clip")
      .not("r2_url", "is", null)
      .eq("playlists.user_id", userId),
  );
  if (clips.length === 0) return;

  const legacy = clips.filter((c) => shippedStart(c.r2_url) === null).map((c) => c.id);
  if (legacy.length > 0) {
    const { error } = await admin.from("playlist_clips").update({ r2_url: null }).in("id", legacy);
    if (error) throw new Error(`lookup_failed ${error.message}`);
  }

  const { data: matchData } = await admin.from("matches").select("sync_point").eq("id", matchId).maybeSingle();
  const sync = (matchData as { sync_point?: SyncPointLike | null } | null)?.sync_point ?? null;
  if (!sync || typeof sync.syncVideoTime !== "number") return;
  const comparable = clips.filter((c) => shippedStart(c.r2_url) !== null);
  if (comparable.length === 0) return;
  const events = await rows<{ event_id: number; period: number | null; real_world_time: string | null }>(
    admin.from("play_by_play_events").select("event_id, period, real_world_time").eq("match_id", matchId).in("event_id", [...new Set(comparable.map((c) => c.event_id))]),
  );
  const eventById = new Map(events.map((e) => [e.event_id, e]));

  const stalePlaylists = new Set<string>();
  for (const clip of comparable) {
    const event = eventById.get(clip.event_id);
    if (!event) continue;
    const t = computeVideoTime({ realWorldTime: event.real_world_time, period: event.period }, sync);
    if (t === null) continue;
    const pair = playlistRolls({ preRoll: clip.playlists?.pre_roll, postRoll: clip.playlists?.post_roll });
    const preOff = Number(clip.pre_roll_offset ?? 0) || 0;
    const postOff = Number(clip.post_roll_offset ?? 0) || 0;
    const expectedStart = clipBounds(t, pair.pre, pair.post, preOff, postOff).start;
    if (isShippedClipStale({ r2Url: clip.r2_url, preRollOffset: preOff, postRollOffset: postOff }, pair, expectedStart)) stalePlaylists.add(clip.playlist_id);
  }
  for (const playlistId of stalePlaylists) {
    const { data: shared, error } = await admin.rpc("_playlist_is_shared", { p_playlist_id: playlistId });
    if (error) throw new Error(`lookup_failed ${error.message}`);
    if (shared !== true) continue;
    const plan = await buildShipPlan(admin, playlistId);
    if (plan && !plan.demo && plan.clips.length > 0) await enqueueShip(admin, plan);
  }
}
