// Scoutable — cloud game videos Edge Function: exports.
// One MP4 of a playlist (or of a selection of its items), rendered on the
// server from the owner's cloud copies with the desktop's fades, letterbox
// (16:9) or pan (9:16), text and stats cards and the wordmark, delivered the
// desktop's two ways (request.purpose):
//   download  a file in the PRIVATE bucket, <prefix>/exports/<userId>/<jobId>.mp4,
//             saved through export_link (a presigned GET that downloads it as
//             exportFileName); kept EXPORT_KEEP_DAYS, then the retention
//             queues it for the nightly purge (migration 20261021100000)
//   share     a highlight link /h/<shareId>: highlights/<uid>/<shareId>.mp4|jpg
//             in the PUBLIC media bucket and a highlight_shares row, always
//             watermarked; an unexpired link of the same content is handed
//             back instead of a render
// Each export is a render_jobs row (kind export, bookkeeping in jobs.ts). Its
// plan (lib/export-plan.ts over the rows, windows from lib/clip-ship-plan.ts
// as the ship plan's) is previewed at `export` and recomputed at render_take;
// the client's content key is kept on the new link only when both plans are
// the same (their fingerprints match).
//
//   export        (the owner) gates, the preview, a reused link, the live job
//                 of the same purpose and aspect, or a new queued job
//   export_link   (the owner) a fresh link that saves a finished download
//   render_cancel (the owner) stops a queued or running render of either kind
//   takeExport    render_take's export half: the plan, copy GETs, the PUTs
//   doneExport    render_done's export half: the file checked, the link made

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  EXPORT_LINK_SECONDS,
  EXPORT_MIN_SEGMENT_BYTES,
  HIGHLIGHT_KEY_RE,
  RENDER_URL_SECONDS,
  SHARE_LINK_DAYS,
  exportFileName,
  gameVideoExportKey,
  type ExportAspect,
  type ExportJobResult,
  type ExportPurpose,
  type ExportResponse,
  type ExportShare,
  type RenderExportPlan,
  type RenderExportSegment,
} from "../../../packages/shared/lib/game-video-wire.ts";
import { clipBounds, computeVideoTime, playlistRolls, type SyncPointLike } from "../../../packages/shared/lib/clip-ship-plan.ts";
import {
  buildExportPlanSegments,
  exportPlanFingerprint,
  type ExportPlanCopy,
  type ExportPlanItem,
  type ExportPlanSegments,
} from "../../../packages/shared/lib/export-plan.ts";
import {
  APP_URL,
  ForeignKeyError,
  KEY_PREFIX,
  MEDIA_PUBLIC_URL,
  UUID_RE,
  err,
  guardKey,
  headSize,
  mediaConfigured,
  mediaHeadSize,
  objectUrl,
  ok,
  optString,
  presign,
  presignMediaPut,
  presignPut,
  type Payload,
} from "./common.ts";
import {
  CANCELLED,
  JOB_SELECT,
  cloudVideoEnabled,
  finishJob,
  liveJob,
  loadJob,
  lostRace,
  rows,
  startNextWaitingRender,
  startRender,
  updateJob,
  type RenderJobRow,
} from "./jobs.ts";

/** The most items a selection may name (a long playlist's worth). */
const MAX_SELECTION = 1000;

// ---------------------------------------------------------------------------
// What an export job stores
// ---------------------------------------------------------------------------

/** render_jobs.request of an export: what was asked for, and the fingerprint of the plan previewed then. */
interface StoredRequest {
  aspect: ExportAspect;
  purpose: ExportPurpose;
  watermark: boolean;
  selection: string[] | null;
  contentKey: string | null;
  fingerprint: string | null;
}

function storedRequest(v: unknown): StoredRequest | null {
  const r = (v ?? {}) as Record<string, unknown>;
  if ((r.aspect !== "16:9" && r.aspect !== "9:16") || (r.purpose !== "download" && r.purpose !== "share")) return null;
  return {
    aspect: r.aspect,
    purpose: r.purpose,
    watermark: r.watermark !== false,
    selection: Array.isArray(r.selection) ? r.selection.map(String) : null,
    contentKey: typeof r.contentKey === "string" ? r.contentKey : null,
    fingerprint: typeof r.fingerprint === "string" ? r.fingerprint : null,
  };
}

/**
 * render_jobs.params of an export, written at render_take: the plan the
 * renderer got (no URLs), its fingerprint, the files' keys (`keys.video` is
 * also what the migration's trigger queues for a download), and for a share
 * the link id, kept across attempts.
 */
interface StoredParams {
  fingerprint: string;
  shareId: string | null;
  keys: { video: string; poster?: string };
  title: string;
  clips: number;
  cards: number;
}

function storedParams(v: unknown): StoredParams | null {
  const p = (v ?? {}) as Record<string, unknown>;
  const keys = (p.keys ?? {}) as Record<string, unknown>;
  if (typeof p.fingerprint !== "string" || typeof keys.video !== "string") return null;
  return {
    fingerprint: p.fingerprint,
    shareId: typeof p.shareId === "string" && UUID_RE.test(p.shareId) ? p.shareId : null,
    keys: { video: keys.video, ...(typeof keys.poster === "string" ? { poster: keys.poster } : {}) },
    title: typeof p.title === "string" ? p.title : "",
    clips: Number(p.clips) || 0,
    cards: Number(p.cards) || 0,
  };
}

/** True when the job's files go to the media bucket (a share), which then has to be configured. */
export function exportNeedsMedia(job: Pick<RenderJobRow, "kind" | "request">): boolean {
  return job.kind === "export" && (job.request as { purpose?: unknown } | null)?.purpose === "share";
}

// ---------------------------------------------------------------------------
// The plan, from the rows
// ---------------------------------------------------------------------------

interface PlaylistRow {
  id: string;
  user_id: string;
  org_id: string | null;
  name: string | null;
  pre_roll: number | null;
  post_roll: number | null;
}

interface ItemRow {
  id: number;
  item_type: string | null;
  item_id: string | null;
  match_id: string | null;
  event_id: number | null;
  pre_roll_offset: number | string | null;
  post_roll_offset: number | string | null;
  crop_keyframes: unknown;
  text_content: string | null;
  duration_seconds: number | string | null;
  card: unknown;
}

interface MatchRow {
  id: string;
  user_id: string;
  org_id: string | null;
  sync_point: SyncPointLike | null;
  is_demo: boolean | null;
}

interface ExportPlan {
  playlist: PlaylistRow;
  built: ExportPlanSegments;
  /** game_videos.storage_key by id, for the copies the segments cut from. */
  storageKeys: Map<string, string>;
  /** A selected clip of the sample game: never exported. */
  demo: boolean;
}

const clipRef = (matchId: string, eventId: number) => `${matchId}:${eventId}`;

/**
 * The export of the playlist (or of the selected items) as the rows stand:
 * each clip's window as the ship plan computes it (computeVideoTime with the
 * game's sync, clipBounds with the playlist's pair and the clip's offsets), a
 * game's copy usable when a ready game_videos row exists and the owner owns
 * the game or is an admin/coach of its club (the ship plan's rule), then
 * export-plan's segments. Null when the playlist doesn't exist.
 */
async function buildExportPlan(admin: SupabaseClient, playlistId: string, aspect: ExportAspect, selection: readonly string[] | null): Promise<ExportPlan | null> {
  const { data: playlistData, error: playlistError } = await admin
    .from("playlists")
    .select("id, user_id, org_id, name, pre_roll, post_roll")
    .eq("id", playlistId)
    .maybeSingle();
  if (playlistError) throw new Error(`lookup_failed ${playlistError.message}`);
  const playlist = playlistData as unknown as PlaylistRow | null;
  if (!playlist) return null;

  const itemRows = await rows<ItemRow>(
    admin
      .from("playlist_clips")
      .select("id, item_type, item_id, match_id, event_id, pre_roll_offset, post_roll_offset, crop_keyframes, text_content, duration_seconds, card")
      .eq("playlist_id", playlistId)
      .order("position", { ascending: true })
      .order("id", { ascending: true }),
  );
  // The items as the editor lists them (rowToPlaylist): a card needs its item id, a clip its play.
  const clipRows = itemRows.filter((r): r is ItemRow & { match_id: string; event_id: number } => r.item_type !== "text" && !!r.match_id && r.event_id !== null);
  const matchIds = [...new Set(clipRows.map((c) => c.match_id))];
  const eventIds = [...new Set(clipRows.map((c) => c.event_id))];
  const [matches, events, videos] =
    matchIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          rows<MatchRow>(admin.from("matches").select("id, user_id, org_id, sync_point, is_demo").in("id", matchIds)),
          rows<{ match_id: string; event_id: number; period: number | null; real_world_time: string | null }>(
            admin.from("play_by_play_events").select("match_id, event_id, period, real_world_time").in("match_id", matchIds).in("event_id", eventIds),
          ),
          rows<{ id: string; match_id: string; storage_key: string; duration_seconds: number | string | null; fps: number | string | null }>(
            admin.from("game_videos").select("id, match_id, storage_key, duration_seconds, fps").in("match_id", matchIds).eq("status", "ready"),
          ),
        ]);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const eventByRef = new Map(events.map((e) => [clipRef(e.match_id, e.event_id), e]));

  // The org rule, looked up once: the owner's staff memberships in the clubs of games they don't own.
  const foreignOrgs = [...new Set(matches.filter((m) => m.user_id !== playlist.user_id && m.org_id).map((m) => m.org_id as string))];
  const staffOrgs = new Set<string>();
  if (foreignOrgs.length > 0) {
    const memberships = await rows<{ org_id: string; role: string }>(
      admin.from("org_memberships").select("org_id, role").eq("user_id", playlist.user_id).in("org_id", foreignOrgs),
    );
    for (const m of memberships) if (m.role === "admin" || m.role === "coach") staffOrgs.add(m.org_id);
  }
  const copies = new Map<string, ExportPlanCopy>();
  const storageKeys = new Map<string, string>();
  for (const v of videos) {
    const match = matchById.get(v.match_id);
    const usable = !!match && (match.user_id === playlist.user_id || (!!match.org_id && staffOrgs.has(match.org_id)));
    if (!usable) continue;
    copies.set(v.match_id, { videoId: v.id, durationSeconds: finiteOrNull(v.duration_seconds), fps: finiteOrNull(v.fps) });
    storageKeys.set(v.id, v.storage_key);
  }

  const pair = playlistRolls({ preRoll: playlist.pre_roll, postRoll: playlist.post_roll });
  const items: ExportPlanItem[] = [];
  for (const r of itemRows) {
    if (r.item_type === "text") {
      if (r.item_id) items.push({ kind: "card", id: r.item_id, text: r.text_content ?? "", durationSeconds: finiteOrNull(r.duration_seconds), card: r.card ?? null });
      continue;
    }
    if (!r.match_id || r.event_id === null) continue;
    const match = matchById.get(r.match_id);
    const event = eventByRef.get(clipRef(r.match_id, r.event_id));
    const sync = match?.sync_point ?? null;
    const t = match && event && sync && typeof sync.syncVideoTime === "number" ? computeVideoTime({ realWorldTime: event.real_world_time, period: event.period }, sync) : null;
    const preOff = Number(r.pre_roll_offset ?? 0) || 0;
    const postOff = Number(r.post_roll_offset ?? 0) || 0;
    items.push({
      kind: "clip",
      matchId: r.match_id,
      eventId: r.event_id,
      window: t === null ? null : clipBounds(t, pair.pre, pair.post, preOff, postOff),
      cropKeyframes: r.crop_keyframes,
    });
  }
  const built = buildExportPlanSegments({ aspect, items, selection, copies });

  // Every game the export touches, rendered or not: none may be the sample game.
  const touched = new Set([
    ...built.segments.flatMap((s) => (s.kind === "clip" ? [s.matchId] : [])),
    ...built.noCopy.map((n) => n.matchId),
    ...built.dropped.map((d) => d.matchId),
  ]);
  const demo = [...touched].some((id) => matchById.get(id)?.is_demo === true);
  return { playlist, built, storageKeys, demo };
}

function finiteOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fingerprintOf(built: ExportPlanSegments, aspect: ExportAspect, watermark: boolean): string {
  return exportPlanFingerprint({ aspect, watermark, rate: built.rate, segments: built.segments });
}

/** The plan an export is gated and watermarked by (migration 20261021100000). */
async function exportTier(admin: SupabaseClient, playlistId: string): Promise<string> {
  const { data, error } = await admin.rpc("_export_tier_for_playlist", { p_playlist_id: playlistId });
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return typeof data === "string" ? data : "free";
}

function shareOf(id: string, expiresAt: string | null): ExportShare {
  return { shareId: id, url: `${APP_URL}/h/${id}`, expiresAt };
}

/** The owner's newest unexpired link of this playlist, aspect and content, if any (getMyShareForPlaylist's rule). */
async function reusableShare(admin: SupabaseClient, userId: string, playlistId: string, aspect: ExportAspect, contentKey: string): Promise<ExportShare | null> {
  const found = await rows<{ id: string; expires_at: string | null }>(
    admin
      .from("highlight_shares")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("playlist_id", playlistId)
      .eq("aspect", aspect)
      .eq("content_key", contentKey)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1),
  );
  return found[0] ? shareOf(found[0].id, found[0].expires_at) : null;
}

/** A request's selection: null for none, the item keys deduplicated, or "invalid". */
function selectionOf(v: unknown): string[] | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_SELECTION) return "invalid";
  if (!v.every((k) => typeof k === "string" && k.length > 0 && k.length <= 200)) return "invalid";
  return [...new Set(v as string[])];
}

// ---------------------------------------------------------------------------
// Actions: the owner
// ---------------------------------------------------------------------------

/**
 * `export`: the checks (the owner, the kill switch, the plan — free plans
 * get upgrade_required —, the sample game, something to render), the
 * wordmark rule (a share always; a download on Rookie always, on Pro and
 * Franchise unless `watermark: false`), then a share's unexpired link of the
 * same content (no selection, not `fresh`), the live job of the same purpose
 * and aspect, or a new queued job and a renderer for it. An unreachable
 * renderer never fails the request: the job waits for the sweep.
 */
export async function exportPlaylist(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const playlistId = optString(p.playlistId, 36);
  const aspect = p.aspect === "16:9" || p.aspect === "9:16" ? (p.aspect as ExportAspect) : null;
  const purpose = p.purpose === "download" || p.purpose === "share" ? (p.purpose as ExportPurpose) : null;
  const selection = selectionOf(p.selection);
  const contentKey = p.contentKey === undefined || p.contentKey === null ? null : optString(p.contentKey, 128);
  if (!playlistId || !UUID_RE.test(playlistId) || !aspect || !purpose || selection === "invalid") return err(400, "invalid_request");
  if ((p.watermark !== undefined && typeof p.watermark !== "boolean") || (p.contentKey !== undefined && p.contentKey !== null && contentKey === null)) {
    return err(400, "invalid_request");
  }
  if (!(await cloudVideoEnabled(admin))) return err(503, "feature_disabled");
  if (purpose === "share" && !mediaConfigured()) return err(503, "renderer_unavailable");

  const plan = await buildExportPlan(admin, playlistId, aspect, selection);
  // 403 also for a playlist that doesn't exist, so nothing leaks.
  if (!plan || plan.playlist.user_id !== userId) return err(403, "not_owner");
  const tier = await exportTier(admin, playlistId);
  if (tier === "free") return err(403, "upgrade_required");
  if (plan.demo) return err(400, "demo_game");
  const { built } = plan;
  // Cards alone make no export, as on the desktop (it refuses one without a clip in its video).
  if (built.clips === 0) return err(400, "nothing_to_export", { noCopy: built.noCopy, dropped: built.dropped });

  const watermark = purpose === "share" || !(tier === "pro" || tier === "franchise") || p.watermark !== false;
  const preview = { clips: built.clips, cards: built.cards, noCopy: built.noCopy, dropped: built.dropped };

  if (purpose === "share" && p.fresh !== true && !selection && contentKey) {
    const share = await reusableShare(admin, userId, playlistId, aspect, contentKey);
    if (share) return ok({ jobId: null, status: "done", reused: true, share, ...preview, watermark: true } satisfies ExportResponse);
  }

  // One live job per purpose and aspect: a second request lands on it (as it was asked for).
  const coalesce = (live: RenderJobRow): Response =>
    ok({ jobId: live.id, status: live.status, reused: false, ...preview, watermark: (live.request as { watermark?: unknown } | null)?.watermark !== false } satisfies ExportResponse);
  const live = await liveJob(admin, playlistId, "export", { aspect, purpose });
  if (live) return coalesce(live);

  const request = {
    aspect,
    purpose,
    watermark,
    ...(selection ? { selection } : {}),
    ...(purpose === "share" && contentKey ? { contentKey } : {}),
    fingerprint: fingerprintOf(built, aspect, watermark),
  };
  const { data, error } = await admin
    .from("render_jobs")
    .insert({ kind: "export", playlist_id: playlistId, user_id: userId, org_id: plan.playlist.org_id, status: "queued", request })
    .select(JOB_SELECT)
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await liveJob(admin, playlistId, "export", { aspect, purpose });
      if (again) return coalesce(again);
    }
    throw new Error(`lookup_failed ${error.message}`);
  }
  const job = data as unknown as RenderJobRow;
  await startRender(admin, job);
  return ok({ jobId: job.id, status: "queued", reused: false, ...preview, watermark } satisfies ExportResponse);
}

/**
 * `export_link`: a fresh presigned GET of a finished download that saves it
 * (Content-Disposition attachment with the desktop's file name), valid
 * EXPORT_LINK_SECONDS. A job that never finished, or whose file is gone
 * (kept EXPORT_KEEP_DAYS; the row goes with it), is export_expired.
 */
export async function exportLink(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const jobId = optString(p.jobId, 36);
  if (!jobId || !UUID_RE.test(jobId)) return err(400, "invalid_request");
  const job = await loadJob(admin, jobId);
  if (!job) return err(410, "export_expired");
  if (job.user_id !== userId) return err(403, "not_owner");
  const req = storedRequest(job.request);
  if (job.kind !== "export" || req?.purpose !== "download") return err(400, "invalid_request");
  const result = (job.result ?? {}) as { key?: unknown; filename?: unknown };
  // Only this job's own key, whatever the row says.
  const key = gameVideoExportKey(KEY_PREFIX, job.user_id, job.id);
  if (job.status !== "done" || result.key !== key) return err(410, "export_expired");
  const size = await headSize(key);
  if (size === null || size < EXPORT_MIN_SEGMENT_BYTES) return err(410, "export_expired");

  const filename = typeof result.filename === "string" && /^[A-Za-z0-9_]+\.mp4$/.test(result.filename) ? result.filename : exportFileName("", req.aspect);
  const url = await presign(
    "GET",
    objectUrl(key, { "response-content-disposition": `attachment; filename="${filename}"`, "response-content-type": "video/mp4" }),
    EXPORT_LINK_SECONDS,
  );
  return ok({ url, expiresAt: new Date(Date.now() + EXPORT_LINK_SECONDS * 1000).toISOString(), filename });
}

/**
 * `render_cancel`: the owner stops a queued or running render (an export, or
 * a ship). The job fails `cancelled` at once; its renderer hears it at its
 * next call (409 cancelled) and stops. A job already settled is answered as
 * it stands.
 */
export async function renderCancel(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const jobId = optString(p.jobId, 36);
  if (!jobId || !UUID_RE.test(jobId)) return err(400, "invalid_request");
  const job = await loadJob(admin, jobId);
  if (!job) return err(404, "not_found");
  if (job.user_id !== userId) return err(403, "not_owner");
  if (job.status !== "queued" && job.status !== "running") return ok({ jobId: job.id, status: job.status });
  const { data, error } = await admin
    .from("render_jobs")
    .update({ status: "failed", error: CANCELLED, heartbeat_at: null, progress: null, requeue: false, finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .in("status", ["queued", "running"])
    .select("id");
  if (error) throw new Error(`lookup_failed ${error.message}`);
  if (!data || data.length === 0) {
    const now = await loadJob(admin, job.id);
    return ok({ jobId: job.id, status: now?.status ?? job.status });
  }
  await startNextWaitingRender(admin, userId);
  return ok({ jobId: job.id, status: "failed" });
}

// ---------------------------------------------------------------------------
// The renderer's calls (render.ts hands an export job's over)
// ---------------------------------------------------------------------------

/**
 * render_take's export half, after the claim: the plan from the rows as they
 * stand, presigned GETs of the copies it cuts from, and the PUTs of its
 * files (content types signed in): a download's in the private bucket, a
 * share's video and poster in the media bucket under a link id minted once
 * and kept across attempts. The plan and its fingerprint go into params.
 */
export async function takeExport(admin: SupabaseClient, job: RenderJobRow, attempt: number): Promise<Response> {
  const req = storedRequest(job.request);
  if (!req) {
    await finishJob(admin, job.id, "failed", "invalid_request");
    return err(409, "wrong_status");
  }
  const plan = await buildExportPlan(admin, job.playlist_id, req.aspect, req.selection);
  const refusal = !plan ? "not_found" : plan.demo ? "demo_game" : plan.built.clips === 0 ? "nothing_to_export" : null;
  if (!plan || refusal) {
    await finishJob(admin, job.id, "failed", refusal);
    await startNextWaitingRender(admin, job.user_id);
    return err(409, "wrong_status");
  }
  const { built } = plan;

  const copies: Record<string, { url: string }> = {};
  for (const s of built.segments) {
    if (s.kind !== "clip" || copies[s.videoId]) continue;
    const storageKey = plan.storageKeys.get(s.videoId);
    if (!storageKey) throw new Error(`lookup_failed no storage key for ${s.videoId}`);
    copies[s.videoId] = { url: await presign("GET", objectUrl(guardKey(storageKey)), RENDER_URL_SECONDS) };
  }

  let shareId: string | null = null;
  let keys: RenderExportPlan["keys"];
  let put: RenderExportPlan["put"];
  if (req.purpose === "download") {
    const video = guardKey(gameVideoExportKey(KEY_PREFIX, job.user_id, job.id));
    keys = { video };
    put = { video: await presignPut(video, "video/mp4", RENDER_URL_SECONDS) };
  } else {
    shareId = storedParams(job.params)?.shareId ?? crypto.randomUUID();
    const video = `highlights/${job.user_id}/${shareId}.mp4`;
    const poster = `highlights/${job.user_id}/${shareId}.jpg`;
    if (!HIGHLIGHT_KEY_RE.test(video) || !HIGHLIGHT_KEY_RE.test(poster)) throw new ForeignKeyError(video);
    keys = { video, poster };
    put = { video: await presignMediaPut(video, "video/mp4", RENDER_URL_SECONDS), poster: await presignMediaPut(poster, "image/jpeg", RENDER_URL_SECONDS) };
  }

  const title = plan.playlist.name ?? "";
  const fingerprint = fingerprintOf(built, req.aspect, req.watermark);
  // No URL is ever stored: params is the owner's to read.
  await updateJob(admin, job.id, {
    params: {
      fingerprint,
      ...(shareId ? { shareId } : {}),
      keys,
      title,
      clips: built.clips,
      cards: built.cards,
      plan: { aspect: req.aspect, purpose: req.purpose, watermark: req.watermark, rate: built.rate, segments: built.segments },
      noCopy: built.noCopy,
      dropped: built.dropped,
    },
  });
  const exportPlan: RenderExportPlan = {
    aspect: req.aspect,
    purpose: req.purpose,
    watermark: req.watermark,
    rate: built.rate,
    title,
    segments: built.segments as RenderExportSegment[],
    put,
    keys,
  };
  return ok({ jobId: job.id, attempt, kind: "export", copies, clips: [], publicBase: MEDIA_PUBLIC_URL, export: exportPlan });
}

function outcomeOf(v: unknown): { sizeBytes: number; durationSeconds: number; posterOk: boolean } | null {
  const o = (v ?? null) as { sizeBytes?: unknown; durationSeconds?: unknown; posterOk?: unknown } | null;
  if (!o || typeof o.sizeBytes !== "number" || !Number.isFinite(o.sizeBytes) || typeof o.durationSeconds !== "number" || !Number.isFinite(o.durationSeconds)) return null;
  return { sizeBytes: o.sizeBytes, durationSeconds: Math.max(0, o.durationSeconds), posterOk: o.posterOk === true };
}

const doneResponse = (jobId: string) => ({ jobId, status: "done" as const, shipped: 0, failed: 0, superseded: 0 });

/**
 * render_done's export half (fenced and not cancelled already): the file is
 * there and of a real size (else the job fails output_missing); a share
 * becomes its highlight_shares row (the content key kept only when the plan
 * rendered is the one previewed); the job is done with ExportJobResult
 * (+ `key` for a download, which export_link reads). Idempotent: a repeat
 * finds the job done, and the link row is upserted by its id.
 */
export async function doneExport(admin: SupabaseClient, job: RenderJobRow, attempt: number, p: Payload): Promise<Response> {
  if (job.status === "done") return ok(doneResponse(job.id)); // a retried done
  if (job.status !== "running") return err(409, "wrong_status");
  const outcome = outcomeOf(p.export);
  if (!outcome) return err(400, "invalid_request");
  const req = storedRequest(job.request);
  const params = storedParams(job.params);
  if (!req || !params) return err(409, "wrong_status");
  if (req.purpose === "share" && !mediaConfigured()) return err(503, "renderer_unavailable");

  const size = req.purpose === "download" ? await headSize(params.keys.video) : await mediaHeadSize(params.keys.video);
  if (size === null || size < EXPORT_MIN_SEGMENT_BYTES) {
    console.error("[game-video] an export's file is missing or too small:", job.id, size);
    await finishJob(admin, job.id, "failed", "output_missing");
    await startNextWaitingRender(admin, job.user_id);
    return err(409, "output_missing");
  }

  const result: ExportJobResult & { key?: string } = {
    purpose: req.purpose,
    aspect: req.aspect,
    watermark: req.watermark,
    clips: params.clips,
    cards: params.cards,
    durationSeconds: outcome.durationSeconds,
    sizeBytes: size,
  };
  if (req.purpose === "download") {
    result.key = params.keys.video;
    result.filename = exportFileName(params.title, req.aspect);
  } else {
    if (!params.shareId) return err(409, "wrong_status");
    const poster = params.keys.poster && outcome.posterOk && ((await mediaHeadSize(params.keys.poster)) ?? 0) > 0 ? params.keys.poster : null;
    const expiresAt = new Date(Date.now() + SHARE_LINK_DAYS * 24 * 3600 * 1000).toISOString();
    const { error } = await admin.from("highlight_shares").upsert(
      {
        id: params.shareId,
        user_id: job.user_id,
        playlist_id: job.playlist_id,
        title: params.title || "Highlights",
        r2_url: `${MEDIA_PUBLIC_URL}/${params.keys.video}`,
        r2_key: params.keys.video,
        poster_url: poster ? `${MEDIA_PUBLIC_URL}/${poster}` : null,
        poster_key: poster,
        clip_count: params.clips,
        aspect: req.aspect,
        // The client's key describes what it previewed; it names this file only if nothing changed before the render.
        content_key: req.contentKey && req.fingerprint === params.fingerprint ? req.contentKey : null,
        expires_at: expiresAt,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`lookup_failed ${error.message}`);
    result.shareId = params.shareId;
    result.url = shareOf(params.shareId, expiresAt).url;
  }

  // Fenced in the write: a cancel landing since the read wins (the link stays, harmless).
  const { data, error } = await admin
    .from("render_jobs")
    .update({ status: "done", error: null, result, progress: 1, heartbeat_at: null, requeue: false, finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("attempt", attempt)
    .eq("status", "running")
    .select("id");
  if (error) throw new Error(`lookup_failed ${error.message}`);
  if (!data || data.length === 0) return lostRace(admin, job.id, attempt);
  await startNextWaitingRender(admin, job.user_id);
  return ok(doneResponse(job.id));
}
