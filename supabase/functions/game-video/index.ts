// Scoutable — cloud game videos Edge Function
// The only place the private game-video bucket's credentials exist. The
// desktop makes a 720p copy of a whole game and uploads it here in parts; a
// browser uploads the ORIGINAL and our converter (a container the Worker at
// GAME_VIDEO_CONVERT_URL starts) makes the copy, finds the tip-off and
// reports back through the job_* actions; the web plays copies through a
// presigned GET minted for the uploader. Rows in game_videos are written
// here only (service role); clients read their own.
//
//   POST { action, … }, shapes in packages/shared/lib/game-video-wire.ts
//     begin          start, or resume, a multipart upload (owner, kill switch, cap);
//                    origin "browser" uploads the original to a source key
//     sign_parts     presigned PUT URLs for part numbers (1 h)
//     complete       finish the multipart upload; a copy is verified and marked
//                    ready, an original goes to converting and the converter starts
//     abort          drop an unfinished upload
//     remove         drop a ready, converting or failed copy (and its original)
//     play           presigned GET for the uploader (12 h)
//     retry_convert  run a failed conversion again while the original is kept
//     sync_set       the uploader confirms or sets the sync the converter found
//     purge          drain the deletion queue (x-purge-secret: pg_cron nightly,
//                    the web's delete-account route, the smoke script)
//     sweep          conversions housekeeping (x-worker-secret: pg_cron every 10 min)
//     job_take, job_progress, job_sign_parts, job_done, job_failed
//                    the converter's calls (x-worker-secret), each fenced by the
//                    attempt number it was given in job_take
//
// Setup:
//   npx supabase functions deploy game-video --project-ref <ref>
//     (never a bare deploy-all or --prune from a feature branch)
//   npx supabase secrets set --project-ref <ref> \
//     R2_VIDEOS_ENDPOINT=https://<account>.eu.r2.cloudflarestorage.com \
//     R2_VIDEOS_BUCKET=<private bucket>  R2_VIDEOS_ACCESS_KEY_ID=…  R2_VIDEOS_SECRET_ACCESS_KEY=… \
//     GAME_VIDEO_PURGE_SECRET=<same value as app_config.game_video_purge_secret> \
//     GAME_VIDEO_WORKER_SECRET=<same value as app_config.game_video_worker_secret and the Worker's WORKER_SECRET> \
//     GAME_VIDEO_CONVERT_URL=https://<worker>.workers.dev  GAME_VIDEO_CONVERT_SECRET=<the Worker's CONVERT_SECRET> \
//     [R2_VIDEOS_PREFIX=<key prefix; defaults to the project ref>]
//   Without GAME_VIDEO_CONVERT_URL browser uploads answer converter_unavailable;
//   desktop copies keep working.
//   verify_jwt = false in supabase/config.toml: pg_cron's calls carry a secret
//   header, not a JWT, so every user action checks the JWT itself
//   (admin.auth.getUser), as genius does.
//
// Keys are `<prefix>/games/<matchId>/<videoId>.mp4` (copies) and
// `<prefix>/sources/<matchId>/<videoId>.<ext>` (originals), the prefix being
// this project's ref. Staging and prod share one bucket and one token, so
// guardKey() refuses to touch any key outside this project's prefix: a
// staging database re-seeded from prod can never delete prod's objects.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import {
  GAME_VIDEO_HEARTBEAT_STALE_SECONDS,
  GAME_VIDEO_MAX_ATTEMPTS,
  GAME_VIDEO_PART_SIZE,
  GAME_VIDEO_PART_URL_SECONDS,
  GAME_VIDEO_PLAY_URL_SECONDS,
  GAME_VIDEO_SIGN_BATCH,
  GAME_VIDEO_SOURCE_KEEP_DAYS,
  GAME_VIDEO_SOURCE_URL_SECONDS,
  bareEtag,
  completeMultipartXml,
  gameVideoKey,
  gameVideoSourceKey,
  isGameVideoKey,
  isValidKeyPrefix,
  parseListParts,
  partsComplete,
  planParts,
  projectRefFromUrl,
  s3ErrorCode,
  sourceExtension,
  type GameVideoAnchorKind,
  type GameVideoJobMatch,
  type GameVideoPart,
  type GameVideoPurgeResponse,
  type GameVideoSweepResponse,
  type GameVideoSyncOutcome,
} from "../../../packages/shared/lib/game-video-wire.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const R2_ENDPOINT = (Deno.env.get("R2_VIDEOS_ENDPOINT") ?? "").replace(/\/$/, "");
const R2_BUCKET = Deno.env.get("R2_VIDEOS_BUCKET") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_VIDEOS_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_VIDEOS_SECRET_ACCESS_KEY") ?? "";
const PURGE_SECRET = Deno.env.get("GAME_VIDEO_PURGE_SECRET") ?? "";
const WORKER_SECRET = Deno.env.get("GAME_VIDEO_WORKER_SECRET") ?? "";
const CONVERT_URL = (Deno.env.get("GAME_VIDEO_CONVERT_URL") ?? "").replace(/\/$/, "");
const CONVERT_SECRET = Deno.env.get("GAME_VIDEO_CONVERT_SECRET") ?? "";
const KEY_PREFIX = Deno.env.get("R2_VIDEOS_PREFIX") || projectRefFromUrl(SUPABASE_URL) || "";

const MATCH_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURGE_BATCH = 100;
const SWEEP_BATCH = 20;
/** Conversions running at once across every user; the Worker's max_instances (20) keeps headroom above it. */
const MAX_ACTIVE_CONVERSIONS = 15;
const STALE_MS = GAME_VIDEO_HEARTBEAT_STALE_SECONDS * 1000;
const ANCHOR_KINDS: readonly GameVideoAnchorKind[] = ["tipoff", "first_basket", "match_start"];
const SYNC_OUTCOMES: readonly GameVideoSyncOutcome[] = ["confirmed", "estimate", "not_found", "skipped"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey, x-purge-secret, x-worker-secret",
};

function err(status: number, token: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: token, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Constant-time string equality for the shared secrets. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// R2 (S3 API)
// ---------------------------------------------------------------------------

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

function objectUrl(key: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

class ForeignKeyError extends Error {}

/** Every R2 call goes through this: a key outside this project's prefix is never touched. */
function guardKey(key: string): string {
  if (!isGameVideoKey(key, KEY_PREFIX)) throw new ForeignKeyError(key);
  return key;
}

interface S3Result {
  status: number;
  text: string;
  headers: Headers;
  code: string | null;
}

async function s3(method: string, url: URL, init: { headers?: Record<string, string>; body?: string } = {}): Promise<S3Result> {
  const res = await r2.fetch(url.toString(), { method, headers: init.headers, body: init.body });
  const text = method === "HEAD" ? "" : await res.text();
  // S3 can answer 200 with an <Error> body on a CompleteMultipartUpload that failed late.
  const code = s3ErrorCode(text);
  return { status: res.status, text, headers: res.headers, code: res.ok && !code ? null : code ?? `http_${res.status}` };
}

async function presign(method: "PUT" | "GET", url: URL, expiresSeconds: number): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await r2.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

async function createMultipart(key: string, contentType: string): Promise<string> {
  const r = await s3("POST", objectUrl(key, { uploads: "" }), { headers: { "Content-Type": contentType } });
  const m = /<UploadId>([^<]+)<\/UploadId>/.exec(r.text);
  if (r.code || !m) throw new Error(`create_failed ${r.status} ${r.code ?? ""}`);
  return m[1].trim();
}

async function listParts(key: string, uploadId: string): Promise<{ parts: GameVideoPart[] } | { code: string }> {
  const parts: GameVideoPart[] = [];
  let marker: number | null = null;
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = { uploadId, "max-parts": "1000" };
    if (marker !== null) params["part-number-marker"] = String(marker);
    const r = await s3("GET", objectUrl(key, params));
    if (r.code) return { code: r.code };
    const parsed = parseListParts(r.text);
    parts.push(...parsed.parts);
    if (parsed.nextPartNumberMarker === null) break;
    marker = parsed.nextPartNumberMarker;
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return { parts };
}

/** Aborts a multipart upload; an upload R2 no longer knows counts as aborted. */
async function abortMultipart(key: string, uploadId: string): Promise<boolean> {
  const r = await s3("DELETE", objectUrl(key, { uploadId }));
  return !r.code || r.code === "NoSuchUpload" || r.status === 404;
}

/** Deletes an object; a missing object counts as deleted. */
async function deleteObject(key: string): Promise<boolean> {
  const r = await s3("DELETE", objectUrl(key));
  return !r.code || r.code === "NoSuchKey" || r.status === 404;
}

/** The stored object's size, or null when it isn't there. */
async function headSize(key: string): Promise<number | null> {
  const r = await s3("HEAD", objectUrl(key));
  if (r.status !== 200) return null;
  const n = Number(r.headers.get("content-length"));
  return Number.isFinite(n) ? n : null;
}

/** Presigned PUT URLs for part numbers of a multipart upload. */
async function signPartUrls(key: string, uploadId: string, numbers: number[]): Promise<{ urls: { partNumber: number; url: string }[]; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + GAME_VIDEO_PART_URL_SECONDS * 1000).toISOString();
  const urls = await Promise.all(
    numbers.map(async (partNumber) => ({
      partNumber,
      url: await presign("PUT", objectUrl(key, { partNumber: String(partNumber), uploadId }), GAME_VIDEO_PART_URL_SECONDS),
    })),
  );
  return { urls, expiresAt };
}

type CompleteOutcome = { ok: true } | { ok: false; code: string; status: number };

/**
 * CompleteMultipartUpload, then a HEAD to check the stored size. A retry
 * after R2 completed but we timed out finds NoSuchUpload and checks the size
 * the same way. "size_mismatch" means the object was deleted again.
 */
async function completeAndVerify(key: string, uploadId: string, parts: GameVideoPart[], expectedBytes: number): Promise<CompleteOutcome> {
  const r = await s3("POST", objectUrl(key, { uploadId }), {
    headers: { "Content-Type": "application/xml" },
    body: completeMultipartXml(parts),
  });
  if (r.code && r.code !== "NoSuchUpload") {
    if (r.code === "InvalidPart" || r.code === "InvalidPartOrder" || r.code === "EntityTooSmall") return { ok: false, code: r.code, status: 400 };
    console.error("[game-video] CompleteMultipartUpload failed:", r.status, r.code);
    return { ok: false, code: "storage_failed", status: 502 };
  }
  const stored = await headSize(key);
  if (stored !== expectedBytes) {
    console.error("[game-video] size mismatch after complete:", key, stored, expectedBytes);
    if (stored !== null) await deleteObject(key);
    return { ok: false, code: "size_mismatch", status: 409 };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface VideoRow {
  id: string;
  match_id: string;
  uploaded_by: string;
  org_id: string | null;
  status: "uploading" | "converting" | "ready" | "failed";
  storage_key: string;
  upload_id: string | null;
  part_size: number | null;
  size_bytes: number | string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  source_fingerprint: string | null;
  created_at: string;
  updated_at: string;
  origin: "desktop" | "browser";
  source_storage_key: string | null;
  source_upload_id: string | null;
  source_part_size: number | null;
  source_size_bytes: number | string | null;
  source_name: string | null;
  anchor_kind: GameVideoAnchorKind | null;
  anchor_real_world_time: string | null;
  convert_attempts: number;
  convert_heartbeat_at: string | null;
  convert_error: string | null;
  sync_status: string | null;
}

const ROW_SELECT =
  "id, match_id, uploaded_by, org_id, status, storage_key, upload_id, part_size, size_bytes, duration_seconds, width, height, source_fingerprint, created_at, updated_at, " +
  "origin, source_storage_key, source_upload_id, source_part_size, source_size_bytes, source_name, anchor_kind, anchor_real_world_time, " +
  "convert_attempts, convert_heartbeat_at, convert_error, sync_status";

async function loadRow(admin: SupabaseClient, videoId: string): Promise<VideoRow | null> {
  if (!UUID_RE.test(videoId)) return null;
  const { data, error } = await admin.from("game_videos").select(ROW_SELECT).eq("id", videoId).maybeSingle();
  if (error) throw new Error(`lookup_failed ${error.message}`);
  return (data as VideoRow | null) ?? null;
}

async function ownRow(admin: SupabaseClient, userId: string, videoId: string): Promise<VideoRow | null> {
  const row = await loadRow(admin, videoId);
  return row && row.uploaded_by === userId ? row : null;
}

async function markReady(admin: SupabaseClient, videoId: string): Promise<void> {
  const { error } = await admin.rpc("_game_video_mark_ready", { p_video_id: videoId });
  if (error) throw new Error(`mark_ready_failed ${error.message}`);
}

async function markFailed(admin: SupabaseClient, videoId: string, convertError: string | null = null): Promise<void> {
  await admin
    .from("game_videos")
    .update({ status: "failed", upload_id: null, convert_heartbeat_at: null, convert_progress: null, convert_error: convertError })
    .eq("id", videoId);
}

async function update(admin: SupabaseClient, videoId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("game_videos").update(patch).eq("id", videoId);
  if (error) throw new Error(`lookup_failed ${error.message}`);
}

/**
 * Drops a row and the queue entries its delete trigger just wrote for the
 * keys the function has already cleaned up in R2; a key still holding an
 * object stays queued for the nightly purge.
 */
async function dropRow(admin: SupabaseClient, row: VideoRow, cleared: (string | null)[]): Promise<void> {
  const { error } = await admin.from("game_videos").delete().eq("id", row.id);
  if (error) throw new Error(`delete_failed ${error.message}`);
  const keys = cleared.filter((k): k is string => !!k);
  if (keys.length > 0) await admin.from("game_video_deletions").delete().in("storage_key", keys);
}

/** Queues an object for the nightly purge (after a delete that failed, or an original kept past its week). */
async function queueKey(admin: SupabaseClient, key: string): Promise<void> {
  await admin.from("game_video_deletions").upsert({ storage_key: key, upload_id: null }, { onConflict: "storage_key", ignoreDuplicates: true });
}

/** Deletes the original now, or queues it when R2 says no; either way the row forgets it. */
async function dropSource(admin: SupabaseClient, row: VideoRow): Promise<void> {
  if (!row.source_storage_key) return;
  guardKey(row.source_storage_key);
  if (!(await deleteObject(row.source_storage_key))) await queueKey(admin, row.source_storage_key);
  await update(admin, row.id, { source_storage_key: null, source_upload_id: null });
}

function optNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function optInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

function optString(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

function isProfixioMatch(match: { source_game_id: string | null; league_id: string | null } | null): boolean {
  return !!match && ((match.source_game_id ?? "").startsWith("profixio:") || (match.league_id ?? "").startsWith("profixio-"));
}

/** The error tokens the SQL helpers raise, mapped to responses. */
function rpcError(message: string): Response {
  const token = /(?:^|\s)(not_found|wrong_status|stale_attempt|sync_locked|invalid_request|no_anchor|invalid_outcome)(?:\s|$)/.exec(message)?.[1];
  switch (token) {
    case "not_found":
      return err(404, "not_found");
    case "wrong_status":
      return err(409, "wrong_status");
    case "stale_attempt":
      return err(409, "stale_attempt");
    case "sync_locked":
      return err(409, "sync_locked");
    case "invalid_request":
    case "no_anchor":
    case "invalid_outcome":
      return err(400, "invalid_request");
    default:
      console.error("[game-video] rpc failed:", message);
      return err(500, "lookup_failed");
  }
}

// ---------------------------------------------------------------------------
// Starting the converter
// ---------------------------------------------------------------------------

/**
 * Asks the Worker to run a converting row, unless the uploader already has a
 * live conversion or the fleet is busy; the row then waits (heartbeat NULL)
 * for the sweep. Bounded to ten seconds, never throws.
 */
async function startConvert(admin: SupabaseClient, row: VideoRow): Promise<"started" | "waiting" | "unavailable"> {
  if (!CONVERT_URL || !CONVERT_SECRET) return "unavailable";
  const since = new Date(Date.now() - STALE_MS).toISOString();
  const { count: mine } = await admin
    .from("game_videos")
    .select("id", { count: "exact", head: true })
    .eq("uploaded_by", row.uploaded_by)
    .eq("status", "converting")
    .neq("id", row.id)
    .gt("convert_heartbeat_at", since);
  if ((mine ?? 0) > 0) return "waiting";
  const { count: active } = await admin
    .from("game_videos")
    .select("id", { count: "exact", head: true })
    .eq("status", "converting")
    .gt("convert_heartbeat_at", since);
  if ((active ?? 0) >= MAX_ACTIVE_CONVERSIONS) return "waiting";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${CONVERT_URL}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-convert-secret": CONVERT_SECRET },
      body: JSON.stringify({ videoId: row.id }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[game-video] the converter refused to start:", res.status, (await res.text()).slice(0, 200));
      return "waiting";
    }
    return "started";
  } catch (e) {
    console.error("[game-video] the converter could not be reached:", e instanceof Error ? e.message : String(e));
    return "waiting";
  } finally {
    clearTimeout(timer);
  }
}

/** After one of the uploader's conversions ends, their next waiting row may go. */
async function startNextWaiting(admin: SupabaseClient, userId: string): Promise<void> {
  const { data } = await admin
    .from("game_videos")
    .select(ROW_SELECT)
    .eq("uploaded_by", userId)
    .eq("status", "converting")
    .is("convert_heartbeat_at", null)
    .order("created_at", { ascending: true })
    .limit(1);
  const next = (data ?? [])[0] as VideoRow | undefined;
  if (next) await startConvert(admin, next);
}

// ---------------------------------------------------------------------------
// Actions: the apps
// ---------------------------------------------------------------------------

type Payload = Record<string, unknown>;

async function begin(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const matchId = optString(p.matchId, 64);
  if (!matchId || !MATCH_ID_RE.test(matchId)) return err(400, "invalid_request");
  const sizeBytes = optInt(p.sizeBytes);
  if (sizeBytes === null) return err(400, "invalid_request");
  let plan;
  try {
    plan = planParts(sizeBytes);
  } catch (e) {
    const token = e instanceof Error ? e.message : "invalid_request";
    return err(token === "too_large" ? 413 : 400, token === "too_large" ? token : "invalid_request");
  }
  const fingerprintKey = optString(p.fingerprintKey, 128);
  const replace = p.replace === true;
  const browser = p.origin === "browser";

  // A browser upload: the original's name decides the key, the anchor is what the sync will hang on.
  let ext: string | null = null;
  let anchorKind: GameVideoAnchorKind = "tipoff";
  let anchorLabel: string | null = null;
  let anchorTime: string | null = null;
  const sourceName = optString(p.sourceName, 255);
  if (browser) {
    ext = sourceName ? sourceExtension(sourceName) : null;
    if (!ext) return err(400, "unsupported_type");
    if (p.anchorKind !== undefined) {
      if (!ANCHOR_KINDS.includes(p.anchorKind as GameVideoAnchorKind)) return err(400, "invalid_request");
      anchorKind = p.anchorKind as GameVideoAnchorKind;
    }
    anchorLabel = optString(p.anchorLabel, 80);
    anchorTime = optString(p.anchorRealWorldTime, 64);
    if (anchorTime !== null && !Number.isFinite(Date.parse(anchorTime))) return err(400, "invalid_request");
    if (!CONVERT_URL || !CONVERT_SECRET || !WORKER_SECRET) return err(503, "converter_unavailable");
  }

  // The owner, and only for a real game: the sample game streams from Scoutable already.
  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("user_id, org_id, is_demo")
    .eq("id", matchId)
    .maybeSingle();
  if (matchError) return err(500, "lookup_failed");
  if (!match || match.user_id !== userId) return err(403, "not_owner");
  if (match.is_demo) return err(400, "invalid_request");

  const { data: rowsData, error: rowsError } = await admin.from("game_videos").select(ROW_SELECT).eq("match_id", matchId);
  if (rowsError) return err(500, "lookup_failed");
  const rows = (rowsData ?? []) as VideoRow[];
  const ready = rows.find((r) => r.status === "ready");
  if (ready && !replace) return err(409, "already_ready", { videoId: ready.id, status: "ready" });
  const converting = rows.filter((r) => r.status === "converting");
  if (converting.length > 0 && !replace) return err(409, "already_ready", { videoId: converting[0].id, status: "converting" });
  // Replacing while a conversion runs: that conversion is dropped, so it can never swap this new copy out later.
  for (const r of converting) {
    guardKey(r.storage_key);
    if (r.upload_id) await abortMultipart(r.storage_key, r.upload_id);
    await dropRow(admin, r, []);
  }

  // Resume: the same file, interrupted. Anything else in flight for this game is dropped.
  const uploading = rows.filter((r) => r.status === "uploading");
  const same = uploading.find((r) => {
    if ((r.origin === "browser") !== browser) return false;
    if ((r.source_fingerprint ?? null) !== fingerprintKey) return false;
    return browser
      ? Number(r.source_size_bytes) === sizeBytes && !!r.source_upload_id && !!r.source_part_size && !!r.source_storage_key
      : Number(r.size_bytes) === sizeBytes && !!r.upload_id && !!r.part_size;
  });
  if (same) {
    const key = browser ? same.source_storage_key! : same.storage_key;
    const uploadId = browser ? same.source_upload_id! : same.upload_id!;
    const partSize = browser ? same.source_part_size! : same.part_size!;
    guardKey(key);
    const listed = await listParts(key, uploadId);
    if ("parts" in listed) {
      return ok({
        videoId: same.id,
        partSize,
        partCount: Math.ceil(sizeBytes / partSize),
        completedParts: listed.parts,
        resumed: true,
      });
    }
    if (listed.code !== "NoSuchUpload") return err(502, "storage_failed");
    await markFailed(admin, same.id, browser ? "upload_failed" : null); // R2 aborted it (a week passed): start fresh below
  }
  for (const r of uploading) {
    if (r.id === same?.id) continue;
    const key = r.origin === "browser" ? r.source_storage_key : r.storage_key;
    const uploadId = r.origin === "browser" ? r.source_upload_id : r.upload_id;
    if (key && uploadId) {
      guardKey(key);
      await abortMultipart(key, uploadId);
    }
    await dropRow(admin, r, [r.storage_key, r.source_storage_key]);
  }

  const videoId = crypto.randomUUID();
  const copyKey = gameVideoKey(KEY_PREFIX, matchId, videoId);
  const sourceKey = browser ? gameVideoSourceKey(KEY_PREFIX, matchId, videoId, ext!) : null;
  const uploadKey = sourceKey ?? copyKey;
  let uploadId: string;
  try {
    uploadId = await createMultipart(uploadKey, browser ? "application/octet-stream" : "video/mp4");
  } catch (e) {
    console.error("[game-video] CreateMultipartUpload failed:", e instanceof Error ? e.message : String(e));
    return err(502, "storage_failed");
  }

  const common = {
    id: videoId,
    match_id: matchId,
    uploaded_by: userId,
    org_id: match.org_id,
    status: "uploading",
    storage_key: copyKey,
    source_fingerprint: fingerprintKey,
  };
  const row = browser
    ? {
        ...common,
        origin: "browser",
        source_storage_key: sourceKey,
        source_upload_id: uploadId,
        source_part_size: plan.partSize,
        source_size_bytes: sizeBytes,
        source_name: sourceName,
        anchor_kind: anchorKind,
        anchor_label: anchorLabel,
        anchor_real_world_time: anchorTime,
        sync_status: "pending",
      }
    : {
        ...common,
        origin: "desktop",
        upload_id: uploadId,
        part_size: plan.partSize,
        size_bytes: sizeBytes,
        duration_seconds: optNumber(p.durationSeconds),
        width: optInt(p.width),
        height: optInt(p.height),
      };
  const { error: insertError } = await admin.from("game_videos").insert(row);
  if (insertError) {
    await abortMultipart(uploadKey, uploadId);
    // The insert trigger speaks in tokens: the cap and the kill switch.
    if (insertError.message.includes("game_video_limit_reached")) {
      const { data: a } = await admin.rpc("_game_video_allowance", { p_user: userId, p_org: match.org_id });
      const allowance = Array.isArray(a) ? a[0] : a;
      return err(403, "limit_reached", { used: allowance?.used ?? null, maxGames: allowance?.max_games ?? null, tier: allowance?.tier ?? null });
    }
    if (insertError.message.includes("feature_disabled")) return err(503, "feature_disabled");
    console.error("[game-video] insert failed:", insertError.message);
    return err(500, "lookup_failed");
  }

  return ok({ videoId, partSize: plan.partSize, partCount: plan.count, completedParts: [], resumed: false });
}

function partNumbersOf(p: Payload): number[] | null {
  const numbers = Array.isArray(p.partNumbers) ? p.partNumbers : null;
  if (!numbers || numbers.length === 0 || numbers.length > GAME_VIDEO_SIGN_BATCH) return null;
  if (!numbers.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10_000)) return null;
  return numbers as number[];
}

async function signParts(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  const numbers = partNumbersOf(p);
  if (!videoId || !numbers) return err(400, "invalid_request");

  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  const browser = row.origin === "browser";
  const key = browser ? row.source_storage_key : row.storage_key;
  const uploadId = browser ? row.source_upload_id : row.upload_id;
  const partSize = browser ? row.source_part_size : row.part_size;
  const size = Number(browser ? row.source_size_bytes : row.size_bytes);
  if (row.status !== "uploading" || !key || !uploadId || !partSize || !size) return err(409, "wrong_status");
  guardKey(key);
  const count = Math.ceil(size / partSize);
  if (numbers.some((n) => n > count)) return err(400, "invalid_request");
  return ok(await signPartUrls(key, uploadId, numbers));
}

function partsOf(p: Payload): GameVideoPart[] | null {
  const rawParts = Array.isArray(p.parts) ? (p.parts as unknown[]) : [];
  const parts: GameVideoPart[] = [];
  for (const part of rawParts) {
    const pn = (part as { partNumber?: unknown }).partNumber;
    const et = (part as { etag?: unknown }).etag;
    if (typeof pn !== "number" || typeof et !== "string") return null;
    parts.push({ partNumber: pn, etag: bareEtag(et) });
  }
  return parts;
}

async function complete(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status === "ready" || row.status === "converting") return ok({ videoId, status: row.status }); // a retried complete
  const browser = row.origin === "browser";
  const key = browser ? row.source_storage_key : row.storage_key;
  const uploadId = browser ? row.source_upload_id : row.upload_id;
  const partSize = browser ? row.source_part_size : row.part_size;
  const sizeBytes = Number(browser ? row.source_size_bytes : row.size_bytes);
  if (row.status !== "uploading" || !key || !uploadId || !partSize || !sizeBytes) return err(409, "wrong_status");
  guardKey(key);

  const parts = partsOf(p);
  if (!parts || !partsComplete(parts, Math.ceil(sizeBytes / partSize))) return err(400, "invalid_request");

  const done = await completeAndVerify(key, uploadId, parts, sizeBytes);
  if (!done.ok) {
    if (done.code === "size_mismatch") {
      await markFailed(admin, videoId, browser ? "upload_failed" : null);
      if (browser) await update(admin, videoId, { source_storage_key: null, source_upload_id: null });
      return err(409, "size_mismatch");
    }
    if (done.status === 400) return err(400, "invalid_request", { code: done.code });
    return err(502, "storage_failed");
  }

  if (!browser) {
    await markReady(admin, videoId);
    return ok({ videoId, status: "ready" });
  }

  // The original is in; the converter takes it from here.
  await update(admin, videoId, {
    status: "converting",
    source_upload_id: null,
    convert_attempts: 0,
    convert_progress: null,
    convert_heartbeat_at: null,
    convert_error: null,
  });
  const fresh = await loadRow(admin, videoId);
  if (fresh) await startConvert(admin, fresh);
  return ok({ videoId, status: "converting" });
}

async function abort(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status !== "uploading") return err(409, "wrong_status");
  const browser = row.origin === "browser";
  const key = browser ? row.source_storage_key : row.storage_key;
  const uploadId = browser ? row.source_upload_id : row.upload_id;
  if (key) {
    guardKey(key);
    if (uploadId && !(await abortMultipart(key, uploadId))) return err(502, "storage_failed");
  }
  await dropRow(admin, row, [row.storage_key, row.source_storage_key]);
  return ok({ videoId });
}

async function remove(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status === "uploading") return err(409, "wrong_status");
  guardKey(row.storage_key);
  // A conversion in flight: its container finds stale_attempt on its next call and stops.
  if (row.status === "converting" && row.upload_id) await abortMultipart(row.storage_key, row.upload_id);
  if (!(await deleteObject(row.storage_key))) return err(502, "storage_failed");
  const cleared: (string | null)[] = [row.storage_key];
  if (row.source_storage_key) {
    guardKey(row.source_storage_key);
    if (await deleteObject(row.source_storage_key)) cleared.push(row.source_storage_key);
  }
  await dropRow(admin, row, cleared);
  return ok({ videoId });
}

async function play(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const matchId = optString(p.matchId, 64);
  if (!matchId || !MATCH_ID_RE.test(matchId)) return err(400, "invalid_request");
  // The uploader only, in this milestone. 404 either way, so nothing leaks.
  const { data, error } = await admin
    .from("game_videos")
    .select(ROW_SELECT)
    .eq("match_id", matchId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) return err(500, "lookup_failed");
  const row = data as VideoRow | null;
  if (!row || row.uploaded_by !== userId) return err(404, "not_found");
  guardKey(row.storage_key);

  const url = await presign("GET", objectUrl(row.storage_key, { "response-content-type": "video/mp4" }), GAME_VIDEO_PLAY_URL_SECONDS);
  return ok({
    videoId: row.id,
    url,
    expiresAt: new Date(Date.now() + GAME_VIDEO_PLAY_URL_SECONDS * 1000).toISOString(),
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
  });
}

async function retryConvert(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status === "converting") return ok({ videoId, status: "converting" });
  if (row.status !== "failed" || row.origin !== "browser") return err(409, "wrong_status");
  if (!row.source_storage_key) return err(409, "source_expired");
  if (!CONVERT_URL || !CONVERT_SECRET || !WORKER_SECRET) return err(503, "converter_unavailable");
  await update(admin, videoId, {
    status: "converting",
    convert_attempts: 0,
    convert_progress: null,
    convert_heartbeat_at: null,
    convert_error: null,
  });
  const fresh = await loadRow(admin, videoId);
  if (fresh) await startConvert(admin, fresh);
  return ok({ videoId, status: "converting" });
}

async function syncSet(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId || !UUID_RE.test(videoId)) return err(400, "invalid_request");
  const status = p.status === "confirmed" || p.status === "manual" ? p.status : null;
  if (!status) return err(400, "invalid_request");
  const seconds = p.seconds === undefined || p.seconds === null ? null : optNumber(p.seconds);
  if (p.seconds !== undefined && p.seconds !== null && seconds === null) return err(400, "invalid_request");
  if (status === "manual" && seconds === null) return err(400, "invalid_request");
  const { data, error } = await admin.rpc("_game_video_set_sync", {
    p_video_id: videoId,
    p_user: userId,
    p_status: status,
    p_seconds: seconds,
  });
  if (error) return rpcError(error.message);
  const result = data as { sync_status?: string; seconds?: number } | null;
  return ok({ videoId, syncStatus: result?.sync_status ?? status, seconds: result?.seconds ?? seconds });
}

// ---------------------------------------------------------------------------
// Actions: housekeeping (shared secrets)
// ---------------------------------------------------------------------------

async function purge(admin: SupabaseClient): Promise<Response> {
  const { data, error } = await admin
    .from("game_video_deletions")
    .select("storage_key, upload_id")
    .order("queued_at", { ascending: true })
    .limit(PURGE_BATCH);
  if (error) return err(500, "lookup_failed");
  const queue = (data ?? []) as { storage_key: string; upload_id: string | null }[];

  const result: GameVideoPurgeResponse = { deleted: 0, aborted: 0, refused: 0, remaining: 0 };
  for (const item of queue) {
    if (!isGameVideoKey(item.storage_key, KEY_PREFIX)) {
      // Another project's object (a database copied from elsewhere): leave it, say so.
      console.error("[game-video] purge refused a key outside this project's prefix:", item.storage_key);
      result.refused++;
      continue;
    }
    const done = item.upload_id ? await abortMultipart(item.storage_key, item.upload_id) : await deleteObject(item.storage_key);
    if (!done) continue; // stays queued for tomorrow
    const { error: delError } = await admin.from("game_video_deletions").delete().eq("storage_key", item.storage_key);
    if (delError) continue;
    if (item.upload_id) result.aborted++;
    else result.deleted++;
  }
  const { count } = await admin.from("game_video_deletions").select("storage_key", { count: "exact", head: true });
  result.remaining = count ?? 0;
  return ok(result);
}

/**
 * Every ten minutes: rows waiting for a converter get one; rows whose
 * converter went quiet are re-run, or fail for good after three attempts;
 * originals kept past their week and uploads R2 has given up on are
 * cleared. At most SWEEP_BATCH rows per group per call.
 */
async function sweep(admin: SupabaseClient): Promise<Response> {
  const result: GameVideoSweepResponse = { examined: 0, started: 0, failed: 0, expired: 0 };
  const now = Date.now();
  const since = new Date(now - STALE_MS).toISOString();
  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(now - GAME_VIDEO_SOURCE_KEEP_DAYS * 24 * 3600 * 1000).toISOString();

  // Waiting (never taken, or handed back by a failed attempt) and stale conversions.
  const { data: convData } = await admin
    .from("game_videos")
    .select(ROW_SELECT)
    .eq("status", "converting")
    .or(`convert_heartbeat_at.is.null,convert_heartbeat_at.lt.${since}`)
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH);
  for (const row of (convData ?? []) as VideoRow[]) {
    result.examined++;
    const stale = !!row.convert_heartbeat_at;
    if (row.convert_attempts >= GAME_VIDEO_MAX_ATTEMPTS) {
      guardKey(row.storage_key);
      if (row.upload_id) await abortMultipart(row.storage_key, row.upload_id);
      await markFailed(admin, row.id, "gave_up");
      result.failed++;
      continue;
    }
    if (!stale && row.convert_attempts === 0 && row.updated_at < dayAgo) {
      await markFailed(admin, row.id, "converter_unavailable");
      result.failed++;
      continue;
    }
    if (stale) await update(admin, row.id, { convert_heartbeat_at: null, convert_progress: null });
    if ((await startConvert(admin, row)) === "started") result.started++;
  }

  // Originals of failed conversions, a week on.
  const { data: oldFailed } = await admin
    .from("game_videos")
    .select(ROW_SELECT)
    .eq("status", "failed")
    .eq("origin", "browser")
    .not("source_storage_key", "is", null)
    .lt("updated_at", weekAgo)
    .limit(SWEEP_BATCH);
  for (const row of (oldFailed ?? []) as VideoRow[]) {
    result.examined++;
    await dropSource(admin, row);
    result.expired++;
  }

  // Browser uploads nobody finished within the week R2 keeps a multipart upload.
  const { data: oldUploads } = await admin
    .from("game_videos")
    .select(ROW_SELECT)
    .eq("status", "uploading")
    .eq("origin", "browser")
    .lt("created_at", weekAgo)
    .limit(SWEEP_BATCH);
  for (const row of (oldUploads ?? []) as VideoRow[]) {
    result.examined++;
    if (row.source_storage_key && row.source_upload_id) {
      guardKey(row.source_storage_key);
      await abortMultipart(row.source_storage_key, row.source_upload_id);
    }
    await markFailed(admin, row.id, "upload_failed");
    await update(admin, row.id, { source_storage_key: null, source_upload_id: null });
    result.expired++;
  }

  return ok(result);
}

// ---------------------------------------------------------------------------
// Actions: the converter (every write fenced by the attempt it was given)
// ---------------------------------------------------------------------------

/** The row for a converter call, or the response that ends it: not found, no longer converting, or another attempt's. */
async function fenced(admin: SupabaseClient, p: Payload): Promise<{ row: VideoRow; attempt: number } | Response> {
  const videoId = optString(p.videoId, 36);
  const attempt = optInt(p.attempt);
  if (!videoId || !UUID_RE.test(videoId) || attempt === null) return err(400, "invalid_request");
  const row = await loadRow(admin, videoId);
  if (!row) return err(404, "not_found");
  if (row.convert_attempts !== attempt) return err(409, "stale_attempt");
  return { row, attempt };
}

async function jobTake(admin: SupabaseClient, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId || !UUID_RE.test(videoId)) return err(400, "invalid_request");
  const row = await loadRow(admin, videoId);
  if (!row) return err(404, "not_found");
  if (row.status !== "converting" || row.origin !== "browser") return err(409, "wrong_status");
  if (row.convert_heartbeat_at && Date.parse(row.convert_heartbeat_at) > Date.now() - STALE_MS) return err(409, "job_busy");
  if (!row.source_storage_key) {
    await markFailed(admin, row.id, "source_unreadable");
    return err(409, "source_expired");
  }
  const attempt = row.convert_attempts + 1;
  if (attempt > GAME_VIDEO_MAX_ATTEMPTS) {
    await markFailed(admin, row.id, "gave_up");
    return err(409, "wrong_status");
  }

  // The claim: whoever moves the attempt counter first holds the row.
  const { data: claimed, error: claimError } = await admin
    .from("game_videos")
    .update({ convert_attempts: attempt, convert_heartbeat_at: new Date().toISOString(), convert_progress: 0, convert_error: null })
    .eq("id", row.id)
    .eq("status", "converting")
    .eq("convert_attempts", row.convert_attempts)
    .select("id");
  if (claimError) return err(500, "lookup_failed");
  if (!claimed || claimed.length === 0) return err(409, "job_busy");

  guardKey(row.storage_key);
  guardKey(row.source_storage_key);
  if (row.upload_id) await abortMultipart(row.storage_key, row.upload_id); // a dead attempt's copy upload
  let uploadId: string;
  try {
    uploadId = await createMultipart(row.storage_key, "video/mp4");
  } catch (e) {
    console.error("[game-video] CreateMultipartUpload for the copy failed:", e instanceof Error ? e.message : String(e));
    await update(admin, row.id, { convert_heartbeat_at: null, convert_progress: null });
    return err(502, "storage_failed");
  }
  await update(admin, row.id, { upload_id: uploadId, part_size: GAME_VIDEO_PART_SIZE });

  const { data: matchData } = await admin
    .from("matches")
    .select("id, title, source_game_id, league_id")
    .eq("id", row.match_id)
    .maybeSingle();
  const matchRow = matchData as { id: string; title: string | null; source_game_id: string | null; league_id: string | null } | null;
  const match: GameVideoJobMatch = {
    id: row.match_id,
    title: matchRow?.title ?? "",
    sourceGameId: matchRow?.source_game_id ?? null,
    leagueId: matchRow?.league_id ?? null,
    isProfixio: isProfixioMatch(matchRow),
    anchorKind: row.anchor_kind,
    anchorRealWorldTime: row.anchor_real_world_time,
  };
  const sourceUrl = await presign("GET", objectUrl(row.source_storage_key), GAME_VIDEO_SOURCE_URL_SECONDS);
  return ok({
    videoId: row.id,
    attempt,
    sourceUrl,
    sourceSizeBytes: Number(row.source_size_bytes),
    sourceName: row.source_name,
    partSize: GAME_VIDEO_PART_SIZE,
    match,
  });
}

async function jobProgress(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fenced(admin, p);
  if (f instanceof Response) return f;
  if (f.row.status !== "converting") return err(409, "wrong_status");
  const progress = optNumber(p.progress);
  if (progress === null) return err(400, "invalid_request");
  await update(admin, f.row.id, {
    convert_progress: Math.min(0.99, Math.max(0, progress)),
    convert_heartbeat_at: new Date().toISOString(),
  });
  return ok({ videoId: f.row.id, attempt: f.attempt });
}

async function jobSignParts(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fenced(admin, p);
  if (f instanceof Response) return f;
  const numbers = partNumbersOf(p);
  if (!numbers) return err(400, "invalid_request");
  if (f.row.status !== "converting" || !f.row.upload_id) return err(409, "wrong_status");
  guardKey(f.row.storage_key);
  await update(admin, f.row.id, { convert_heartbeat_at: new Date().toISOString() });
  return ok(await signPartUrls(f.row.storage_key, f.row.upload_id, numbers));
}

function fingerprintOf(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  const fp = v as Record<string, unknown>;
  if (typeof fp.key !== "string" || !Array.isArray(fp.hashes) || typeof fp.durationMs !== "number") return null;
  return { version: fp.version ?? 1, durationMs: fp.durationMs, offsetsS: Array.isArray(fp.offsetsS) ? fp.offsetsS : [], hashes: fp.hashes, key: fp.key };
}

async function jobDone(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fenced(admin, p);
  if (f instanceof Response) return f;
  const { row, attempt } = f;
  if (row.status === "ready") return ok({ videoId: row.id, status: "ready", syncStatus: row.sync_status ?? "skipped" }); // a retried done
  if (row.status !== "converting" || !row.upload_id || !row.part_size) return err(409, "wrong_status");
  guardKey(row.storage_key);

  const sizeBytes = optInt(p.sizeBytes);
  const durationSeconds = optNumber(p.durationSeconds);
  const width = optInt(p.width);
  const height = optInt(p.height);
  const fps = optNumber(p.fps);
  const sync = (p.sync ?? null) as { outcome?: unknown; seconds?: unknown; confidence?: unknown } | null;
  const outcome = sync && SYNC_OUTCOMES.includes(sync.outcome as GameVideoSyncOutcome) ? (sync.outcome as GameVideoSyncOutcome) : null;
  if (sizeBytes === null || durationSeconds === null || width === null || height === null || !outcome) return err(400, "invalid_request");
  const tipoff = optNumber(sync?.seconds);
  const confidence = optNumber(sync?.confidence);
  if ((outcome === "confirmed" || outcome === "estimate") && tipoff === null) return err(400, "invalid_request");
  const parts = partsOf(p);
  if (!parts || !partsComplete(parts, Math.ceil(sizeBytes / row.part_size))) return err(400, "invalid_request");

  const done = await completeAndVerify(row.storage_key, row.upload_id, parts, sizeBytes);
  if (!done.ok) {
    if (done.code === "size_mismatch") {
      // The copy was deleted again; the sweep runs another attempt from the original.
      await update(admin, row.id, { convert_heartbeat_at: null, convert_progress: null, upload_id: null, convert_error: "size_mismatch" });
      return err(409, "size_mismatch");
    }
    if (done.status === 400) return err(400, "invalid_request", { code: done.code });
    return err(502, "storage_failed");
  }

  const { data: statusData, error: finishError } = await admin.rpc("_game_video_finish_convert", {
    p_video_id: row.id,
    p_attempt: attempt,
    p_size_bytes: sizeBytes,
    p_duration: durationSeconds,
    p_width: width,
    p_height: height,
    p_fps: fps,
    p_fingerprint: fingerprintOf(p.fingerprint),
    p_outcome: outcome,
    p_tipoff: tipoff,
    p_confidence: confidence,
  });
  if (finishError) return rpcError(finishError.message);
  const syncStatus = typeof statusData === "string" ? statusData : "skipped";

  await dropSource(admin, row);
  await startNextWaiting(admin, row.uploaded_by);
  return ok({ videoId: row.id, status: "ready", syncStatus });
}

async function jobFailed(admin: SupabaseClient, p: Payload): Promise<Response> {
  const f = await fenced(admin, p);
  if (f instanceof Response) return f;
  const { row, attempt } = f;
  if (row.status !== "converting") return ok({ videoId: row.id, status: row.status, attempt }); // already settled
  const error = optString(p.error, 64) ?? "unknown";
  const retryable = p.retryable !== false;
  guardKey(row.storage_key);
  if (row.upload_id) await abortMultipart(row.storage_key, row.upload_id);

  const final = !retryable || attempt >= GAME_VIDEO_MAX_ATTEMPTS;
  if (final) {
    await markFailed(admin, row.id, retryable ? "gave_up" : error);
    if (!retryable) await dropSource(admin, row); // a retry would fail the same way: the original goes now
    await startNextWaiting(admin, row.uploaded_by);
    return ok({ videoId: row.id, status: "failed", attempt });
  }
  // Handed back for the sweep to run again.
  await update(admin, row.id, { upload_id: null, convert_heartbeat_at: null, convert_progress: null, convert_error: error });
  return ok({ videoId: row.id, status: "converting", attempt });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return err(405, "method_not_allowed");

  // Fail closed: a half-configured signer must refuse, not mint dead URLs or touch the wrong prefix.
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !isValidKeyPrefix(KEY_PREFIX)) {
    console.error("[game-video] R2_VIDEOS_* secrets or the key prefix are not configured — refusing all requests");
    return err(500, "server_misconfigured");
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return err(400, "invalid_json");
  }
  const action = typeof payload.action === "string" ? payload.action : "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Housekeeping carries a shared secret, not a session: pg_cron has no JWT
    // to offer. (Comparing a bearer with SUPABASE_SERVICE_ROLE_KEY was tried
    // and doesn't hold: the value the runtime injects isn't the key the CLI
    // lists for new projects.)
    if (action === "purge") {
      const secret = req.headers.get("x-purge-secret");
      if (secret === null || PURGE_SECRET.length === 0 || !safeEqual(secret, PURGE_SECRET)) return err(401, "bad_purge_secret");
      return await purge(admin);
    }
    if (action === "sweep" || action.startsWith("job_")) {
      const secret = req.headers.get("x-worker-secret");
      if (secret === null || WORKER_SECRET.length === 0 || !safeEqual(secret, WORKER_SECRET)) return err(401, "bad_worker_secret");
      switch (action) {
        case "sweep":
          return await sweep(admin);
        case "job_take":
          return await jobTake(admin, payload);
        case "job_progress":
          return await jobProgress(admin, payload);
        case "job_sign_parts":
          return await jobSignParts(admin, payload);
        case "job_done":
          return await jobDone(admin, payload);
        case "job_failed":
          return await jobFailed(admin, payload);
        default:
          return err(400, "invalid_request");
      }
    }

    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData?.user) return err(401, "not_authenticated");
    const userId = userData.user.id;

    switch (action) {
      case "begin":
        return await begin(admin, userId, payload);
      case "sign_parts":
        return await signParts(admin, userId, payload);
      case "complete":
        return await complete(admin, userId, payload);
      case "abort":
        return await abort(admin, userId, payload);
      case "remove":
        return await remove(admin, userId, payload);
      case "play":
        return await play(admin, userId, payload);
      case "retry_convert":
        return await retryConvert(admin, userId, payload);
      case "sync_set":
        return await syncSet(admin, userId, payload);
      default:
        return err(400, "invalid_request");
    }
  } catch (e) {
    if (e instanceof ForeignKeyError) {
      console.error("[game-video] refused a key outside this project's prefix:", e.message);
      return err(409, "foreign_object");
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[game-video] failed:", message);
    const internal = message.startsWith("lookup_failed") || message.startsWith("delete_failed") || message.startsWith("mark_ready_failed");
    return err(internal ? 500 : 502, message.startsWith("lookup_failed") ? "lookup_failed" : internal ? "lookup_failed" : "storage_failed");
  }
});
