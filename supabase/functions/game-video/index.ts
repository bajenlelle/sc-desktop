// Scoutable — cloud game videos Edge Function
// The only place the private game-video bucket's credentials exist. The
// desktop makes a 720p copy of a whole game and uploads it here in parts; the
// web plays it through a presigned GET minted for the uploader. Rows in
// game_videos are written here only (service role); clients read their own.
//
//   POST { action, … }, shapes in packages/shared/lib/game-video-wire.ts
//     begin        start, or resume, a multipart upload (owner, kill switch, cap)
//     sign_parts   presigned PUT URLs for part numbers (1 h)
//     complete     finish the multipart upload, verify the size, mark ready
//     abort        drop an unfinished upload
//     remove       drop a ready or failed copy
//     play         presigned GET for the uploader (12 h)
//     purge        drain the deletion queue (x-purge-secret header: pg_cron nightly,
//                  the web's delete-account route, the smoke script)
//
// Setup:
//   npx supabase functions deploy game-video --project-ref <ref>
//     (never a bare deploy-all or --prune from a feature branch)
//   npx supabase secrets set --project-ref <ref> \
//     R2_VIDEOS_ENDPOINT=https://<account>.eu.r2.cloudflarestorage.com \
//     R2_VIDEOS_BUCKET=<private bucket>  R2_VIDEOS_ACCESS_KEY_ID=…  R2_VIDEOS_SECRET_ACCESS_KEY=… \
//     GAME_VIDEO_PURGE_SECRET=<same value as app_config.game_video_purge_secret>
//     [R2_VIDEOS_PREFIX=<key prefix; defaults to the project ref>]
//   verify_jwt = false in supabase/config.toml: pg_cron's purge call carries a
//   secret header, not a JWT, so every user action checks the JWT itself
//   (admin.auth.getUser), as genius does.
//
// Keys are `<prefix>/games/<matchId>/<videoId>.mp4`, the prefix being this
// project's ref. Staging and prod share one bucket and one token, so
// guardKey() refuses to touch any key outside this project's prefix: a
// staging database re-seeded from prod can never delete prod's objects.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import {
  GAME_VIDEO_PART_URL_SECONDS,
  GAME_VIDEO_PLAY_URL_SECONDS,
  GAME_VIDEO_SIGN_BATCH,
  bareEtag,
  completeMultipartXml,
  gameVideoKey,
  isGameVideoKey,
  isValidKeyPrefix,
  parseListParts,
  partsComplete,
  planParts,
  projectRefFromUrl,
  s3ErrorCode,
  type GameVideoPart,
  type GameVideoPurgeResponse,
} from "../../../packages/shared/lib/game-video-wire.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const R2_ENDPOINT = (Deno.env.get("R2_VIDEOS_ENDPOINT") ?? "").replace(/\/$/, "");
const R2_BUCKET = Deno.env.get("R2_VIDEOS_BUCKET") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_VIDEOS_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_VIDEOS_SECRET_ACCESS_KEY") ?? "";
const PURGE_SECRET = Deno.env.get("GAME_VIDEO_PURGE_SECRET") ?? "";
const KEY_PREFIX = Deno.env.get("R2_VIDEOS_PREFIX") || projectRefFromUrl(SUPABASE_URL) || "";

const MATCH_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURGE_BATCH = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey, x-purge-secret",
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

async function createMultipart(key: string): Promise<string> {
  const r = await s3("POST", objectUrl(key, { uploads: "" }), { headers: { "Content-Type": "video/mp4" } });
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

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface VideoRow {
  id: string;
  match_id: string;
  uploaded_by: string;
  org_id: string | null;
  status: "uploading" | "ready" | "failed";
  storage_key: string;
  upload_id: string | null;
  part_size: number | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  source_fingerprint: string | null;
  created_at: string;
}

const ROW_SELECT = "id, match_id, uploaded_by, org_id, status, storage_key, upload_id, part_size, size_bytes, duration_seconds, width, height, source_fingerprint, created_at";

async function ownRow(admin: SupabaseClient, userId: string, videoId: string): Promise<VideoRow | null> {
  if (!UUID_RE.test(videoId)) return null;
  const { data, error } = await admin.from("game_videos").select(ROW_SELECT).eq("id", videoId).maybeSingle();
  if (error) throw new Error(`lookup_failed ${error.message}`);
  const row = data as VideoRow | null;
  return row && row.uploaded_by === userId ? row : null;
}

async function markReady(admin: SupabaseClient, videoId: string): Promise<void> {
  const { error } = await admin.rpc("_game_video_mark_ready", { p_video_id: videoId });
  if (error) throw new Error(`mark_ready_failed ${error.message}`);
}

async function markFailed(admin: SupabaseClient, videoId: string): Promise<void> {
  await admin.from("game_videos").update({ status: "failed", upload_id: null }).eq("id", videoId);
}

/** Drops a row the function has already cleaned up in R2, and the queue entry its trigger just wrote. */
async function dropRow(admin: SupabaseClient, row: VideoRow): Promise<void> {
  const { error } = await admin.from("game_videos").delete().eq("id", row.id);
  if (error) throw new Error(`delete_failed ${error.message}`);
  await admin.from("game_video_deletions").delete().eq("storage_key", row.storage_key);
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

// ---------------------------------------------------------------------------
// Actions
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
  if (ready && !replace) return err(409, "already_ready", { videoId: ready.id });

  // Resume: the same file, interrupted. Anything else in flight for this game is dropped.
  const uploading = rows.filter((r) => r.status === "uploading");
  const same = uploading.find(
    (r) =>
      Number(r.size_bytes) === sizeBytes &&
      (r.source_fingerprint ?? null) === fingerprintKey &&
      !!r.upload_id &&
      !!r.part_size,
  );
  if (same) {
    guardKey(same.storage_key);
    const listed = await listParts(same.storage_key, same.upload_id!);
    if ("parts" in listed) {
      return ok({
        videoId: same.id,
        partSize: same.part_size,
        partCount: Math.ceil(sizeBytes / same.part_size!),
        completedParts: listed.parts,
        resumed: true,
      });
    }
    if (listed.code !== "NoSuchUpload") return err(502, "storage_failed");
    await markFailed(admin, same.id); // R2 aborted it (a week passed): start fresh below
  }
  for (const r of uploading) {
    if (r.id === same?.id) continue;
    guardKey(r.storage_key);
    if (r.upload_id) await abortMultipart(r.storage_key, r.upload_id);
    await dropRow(admin, r);
  }

  const videoId = crypto.randomUUID();
  const key = gameVideoKey(KEY_PREFIX, matchId, videoId);
  let uploadId: string;
  try {
    uploadId = await createMultipart(key);
  } catch (e) {
    console.error("[game-video] CreateMultipartUpload failed:", e instanceof Error ? e.message : String(e));
    return err(502, "storage_failed");
  }

  const { error: insertError } = await admin.from("game_videos").insert({
    id: videoId,
    match_id: matchId,
    uploaded_by: userId,
    org_id: match.org_id,
    status: "uploading",
    storage_key: key,
    upload_id: uploadId,
    part_size: plan.partSize,
    size_bytes: sizeBytes,
    duration_seconds: optNumber(p.durationSeconds),
    width: optInt(p.width),
    height: optInt(p.height),
    source_fingerprint: fingerprintKey,
  });
  if (insertError) {
    await abortMultipart(key, uploadId);
    // The insert trigger speaks in tokens: the cap and the kill switch.
    if (insertError.message.includes("game_video_limit_reached")) {
      const { data: a } = await admin.rpc("_game_video_allowance", { p_user: userId, p_org: match.org_id });
      const row = Array.isArray(a) ? a[0] : a;
      return err(403, "limit_reached", { used: row?.used ?? null, maxGames: row?.max_games ?? null, tier: row?.tier ?? null });
    }
    if (insertError.message.includes("feature_disabled")) return err(503, "feature_disabled");
    console.error("[game-video] insert failed:", insertError.message);
    return err(500, "lookup_failed");
  }

  return ok({ videoId, partSize: plan.partSize, partCount: plan.count, completedParts: [], resumed: false });
}

async function signParts(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  const numbers = Array.isArray(p.partNumbers) ? p.partNumbers : null;
  if (!videoId || !numbers || numbers.length === 0 || numbers.length > GAME_VIDEO_SIGN_BATCH) return err(400, "invalid_request");
  if (!numbers.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10_000)) return err(400, "invalid_request");

  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status !== "uploading" || !row.upload_id || !row.part_size || !row.size_bytes) return err(409, "wrong_status");
  guardKey(row.storage_key);
  const count = Math.ceil(Number(row.size_bytes) / row.part_size);
  if (numbers.some((n) => (n as number) > count)) return err(400, "invalid_request");

  const expiresAt = new Date(Date.now() + GAME_VIDEO_PART_URL_SECONDS * 1000).toISOString();
  const urls = await Promise.all(
    (numbers as number[]).map(async (partNumber) => ({
      partNumber,
      url: await presign("PUT", objectUrl(row.storage_key, { partNumber: String(partNumber), uploadId: row.upload_id! }), GAME_VIDEO_PART_URL_SECONDS),
    })),
  );
  return ok({ urls, expiresAt });
}

async function complete(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status === "ready") return ok({ videoId, status: "ready" }); // a retried complete
  if (row.status !== "uploading" || !row.upload_id || !row.part_size || !row.size_bytes) return err(409, "wrong_status");
  guardKey(row.storage_key);

  const sizeBytes = Number(row.size_bytes);
  const count = Math.ceil(sizeBytes / row.part_size);
  const rawParts = Array.isArray(p.parts) ? (p.parts as unknown[]) : [];
  const parts: GameVideoPart[] = [];
  for (const part of rawParts) {
    const pn = (part as { partNumber?: unknown }).partNumber;
    const et = (part as { etag?: unknown }).etag;
    if (typeof pn !== "number" || typeof et !== "string") return err(400, "invalid_request");
    parts.push({ partNumber: pn, etag: bareEtag(et) });
  }
  if (!partsComplete(parts, count)) return err(400, "invalid_request");

  const r = await s3("POST", objectUrl(row.storage_key, { uploadId: row.upload_id }), {
    headers: { "Content-Type": "application/xml" },
    body: completeMultipartXml(parts),
  });
  if (r.code) {
    if (r.code === "NoSuchUpload") {
      // A retry after R2 completed but we timed out before writing the row.
      const stored = await headSize(row.storage_key);
      if (stored === sizeBytes) {
        await markReady(admin, videoId);
        return ok({ videoId, status: "ready" });
      }
      await markFailed(admin, videoId);
      return err(409, "wrong_status");
    }
    if (r.code === "InvalidPart" || r.code === "InvalidPartOrder" || r.code === "EntityTooSmall") {
      return err(400, "invalid_request", { code: r.code });
    }
    console.error("[game-video] CompleteMultipartUpload failed:", r.status, r.code);
    return err(502, "storage_failed");
  }

  const stored = await headSize(row.storage_key);
  if (stored !== sizeBytes) {
    console.error("[game-video] size mismatch after complete:", row.storage_key, stored, sizeBytes);
    await deleteObject(row.storage_key);
    await markFailed(admin, videoId);
    return err(409, "size_mismatch", { stored, expected: sizeBytes });
  }

  await markReady(admin, videoId);
  return ok({ videoId, status: "ready" });
}

async function abort(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status !== "uploading") return err(409, "wrong_status");
  guardKey(row.storage_key);
  if (row.upload_id && !(await abortMultipart(row.storage_key, row.upload_id))) return err(502, "storage_failed");
  await dropRow(admin, row);
  return ok({ videoId });
}

async function remove(admin: SupabaseClient, userId: string, p: Payload): Promise<Response> {
  const videoId = optString(p.videoId, 36);
  if (!videoId) return err(400, "invalid_request");
  const row = await ownRow(admin, userId, videoId);
  if (!row) return err(404, "not_found");
  if (row.status === "uploading") return err(409, "wrong_status");
  guardKey(row.storage_key);
  if (!(await deleteObject(row.storage_key))) return err(502, "storage_failed");
  await dropRow(admin, row);
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
    return err(message.startsWith("lookup_failed") || message.startsWith("delete_failed") || message.startsWith("mark_ready_failed") ? 500 : 502, message.startsWith("lookup_failed") ? "lookup_failed" : "storage_failed");
  }
});
