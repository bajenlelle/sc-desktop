// Scoutable — cloud game videos Edge Function: what index.ts (uploads,
// conversions), render.ts (server-cut clips) and export.ts (exports) share.
// Configuration from the function's secrets, the response helpers,
// request-field validation, the two R2 clients (the PRIVATE game-video bucket
// behind guardKey(), the PUBLIC media bucket behind guardMediaKey()) and the
// SQL error mapping.
//
// The media bucket's credentials are the R2_* secrets presign-upload uses:
// function secrets are project-wide, so this function sees the same names.
// Without them `ship`, a share `export` and their `render_take` answer
// renderer_unavailable and everything else keeps working.

import { AwsClient } from "npm:aws4fetch@1.0.20";
import {
  CLIP_SHIP_KEY_RE,
  GAME_VIDEO_HEARTBEAT_STALE_SECONDS,
  HIGHLIGHT_KEY_RE,
  isGameVideoExportKey,
  isGameVideoKey,
  mediaPurgeScopeOf,
  projectRefFromUrl,
  s3ErrorCode,
} from "../../../packages/shared/lib/game-video-wire.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const R2_ENDPOINT = (Deno.env.get("R2_VIDEOS_ENDPOINT") ?? "").replace(/\/$/, "");
export const R2_BUCKET = Deno.env.get("R2_VIDEOS_BUCKET") ?? "";
export const R2_ACCESS_KEY_ID = Deno.env.get("R2_VIDEOS_ACCESS_KEY_ID") ?? "";
export const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_VIDEOS_SECRET_ACCESS_KEY") ?? "";
export const PURGE_SECRET = Deno.env.get("GAME_VIDEO_PURGE_SECRET") ?? "";
export const WORKER_SECRET = Deno.env.get("GAME_VIDEO_WORKER_SECRET") ?? "";
export const CONVERT_URL = (Deno.env.get("GAME_VIDEO_CONVERT_URL") ?? "").replace(/\/$/, "");
export const CONVERT_SECRET = Deno.env.get("GAME_VIDEO_CONVERT_SECRET") ?? "";
export const KEY_PREFIX = Deno.env.get("R2_VIDEOS_PREFIX") || projectRefFromUrl(SUPABASE_URL) || "";

// The PUBLIC media bucket (shipped clips), presign-upload's secrets.
const MEDIA_ENDPOINT = (Deno.env.get("R2_ENDPOINT") ?? "").replace(/\/$/, "");
const MEDIA_BUCKET = Deno.env.get("R2_BUCKET") ?? "";
const MEDIA_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const MEDIA_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
/** The base shipped clips are served from; persisted verbatim into playlist_clips.r2_url. */
export const MEDIA_PUBLIC_URL = (Deno.env.get("R2_PUBLIC_URL") ?? "").replace(/\/$/, "");
/** The web app a highlight link opens in (`${APP_URL}/h/<shareId>`), as send-email reads it. */
export const APP_URL = (Deno.env.get("APP_URL") ?? "https://app.scoutable.se").replace(/\/$/, "");

export const MATCH_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A heartbeat older than this means the container died; the sweep re-runs the job. */
export const STALE_MS = GAME_VIDEO_HEARTBEAT_STALE_SECONDS * 1000;
/** Rows the sweep looks at per group per call. */
export const SWEEP_BATCH = 20;

export type Payload = Record<string, unknown>;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey, x-purge-secret, x-worker-secret",
};

export function err(status: number, token: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: token, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Constant-time string equality for the shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export function optNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function optInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export function optString(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** The error tokens the SQL helpers raise, mapped to responses. */
export function rpcError(message: string): Response {
  const token = /(?:^|\s)(not_found|wrong_status|stale_attempt|sync_locked|no_sync|invalid_request|no_anchor|invalid_outcome)(?:\s|$)/.exec(message)?.[1];
  switch (token) {
    case "not_found":
      return err(404, "not_found");
    case "wrong_status":
      return err(409, "wrong_status");
    case "stale_attempt":
      return err(409, "stale_attempt");
    case "sync_locked":
      return err(409, "sync_locked");
    case "no_sync":
      return err(409, "no_sync");
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
// R2 (S3 API): the PRIVATE game-video bucket
// ---------------------------------------------------------------------------

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

export function objectUrl(key: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/** A key this function must never touch: another project's prefix, or a media key outside the desktop's schemes. */
export class ForeignKeyError extends Error {}

/**
 * A private-bucket key of this project: a game's copy or original, or a
 * download export (`<prefix>/exports/<userId>/<jobId>.mp4`). The nightly
 * purge deletes only these.
 */
export function isOwnPrivateKey(key: string): boolean {
  return isGameVideoKey(key, KEY_PREFIX) || (key.startsWith(`${KEY_PREFIX}/exports/`) && isGameVideoExportKey(key));
}

/** Every private-bucket call goes through this: a key outside this project's prefix is never touched. */
export function guardKey(key: string): string {
  if (!isOwnPrivateKey(key)) throw new ForeignKeyError(key);
  return key;
}

export interface S3Result {
  status: number;
  text: string;
  headers: Headers;
  code: string | null;
}

export async function s3(method: string, url: URL, init: { headers?: Record<string, string>; body?: string } = {}): Promise<S3Result> {
  const res = await r2.fetch(url.toString(), { method, headers: init.headers, body: init.body });
  const text = method === "HEAD" ? "" : await res.text();
  // S3 can answer 200 with an <Error> body on a CompleteMultipartUpload that failed late.
  const code = s3ErrorCode(text);
  return { status: res.status, text, headers: res.headers, code: res.ok && !code ? null : code ?? `http_${res.status}` };
}

export async function presign(method: "PUT" | "GET", url: URL, expiresSeconds: number): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await r2.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

/**
 * A presigned PUT of one private-bucket object with its Content-Type signed
 * in, so the URL can only write that type (a download export: video/mp4).
 * `allHeaders`: see presignMediaPut.
 */
export async function presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
  const url = objectUrl(guardKey(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await r2.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

/** A private-bucket object's size, or null when it isn't there. */
export async function headSize(key: string): Promise<number | null> {
  const r = await s3("HEAD", objectUrl(guardKey(key)));
  if (r.status !== 200) return null;
  const n = Number(r.headers.get("content-length"));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// R2 (S3 API): the PUBLIC media bucket, for shipped clips
// ---------------------------------------------------------------------------

/** True when the media bucket's secrets are all there; `ship`, a share `export` and their `render_take` refuse otherwise. */
export function mediaConfigured(): boolean {
  return !!(MEDIA_ENDPOINT && MEDIA_BUCKET && MEDIA_ACCESS_KEY_ID && MEDIA_SECRET_ACCESS_KEY && MEDIA_PUBLIC_URL);
}

const media = new AwsClient({
  accessKeyId: MEDIA_ACCESS_KEY_ID,
  secretAccessKey: MEDIA_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

/** The one content type a media key may be written with, by its extension (presign-upload's rule). */
const MEDIA_CONTENT_TYPE: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg" };

/**
 * Every media-bucket key is a shipped clip's or a highlight link's file, in
 * the desktop's schemes (presign-upload admits the same): `clips/…` under
 * clipShipKey, `highlights/<uid>/<shareId>.mp4|jpg`.
 */
export function guardMediaKey(key: string): string {
  if (!CLIP_SHIP_KEY_RE.test(key) && !HIGHLIGHT_KEY_RE.test(key)) throw new ForeignKeyError(key);
  return key;
}

function mediaUrl(key: string): URL {
  return new URL(`${MEDIA_ENDPOINT}/${MEDIA_BUCKET}/${guardMediaKey(key)}`);
}

/**
 * A presigned PUT for a media key with the Content-Type signed in, so the
 * URL can only ever upload the type its extension names (video/mp4 for a
 * clip or a highlight, image/jpeg for a poster). `allHeaders` is required:
 * aws4fetch treats content-type as unsignable by default and would silently
 * drop it (see presign-upload).
 */
export async function presignMediaPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
  const url = mediaUrl(key);
  if (MEDIA_CONTENT_TYPE[key.slice(key.lastIndexOf(".") + 1)] !== contentType) throw new ForeignKeyError(key);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await media.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

/** A media-bucket object's size through the S3 API (not the public URL, which a CDN may cache), or null when it isn't there. */
export async function mediaHeadSize(key: string): Promise<number | null> {
  const res = await media.fetch(mediaUrl(key).toString(), { method: "HEAD" });
  if (res.status !== 200) return null;
  const n = Number(res.headers.get("content-length"));
  return Number.isFinite(n) ? n : null;
}

/**
 * Deletes a shipped clip's file from the media bucket (a `clips/…` key only:
 * the media purge never deletes a highlight's files, which the bucket's
 * lifecycle rule owns). A missing object counts as deleted.
 */
export async function mediaDeleteClip(key: string): Promise<boolean> {
  if (!CLIP_SHIP_KEY_RE.test(key)) throw new ForeignKeyError(key);
  const res = await media.fetch(mediaUrl(key).toString(), { method: "DELETE" });
  await res.body?.cancel();
  return res.ok || res.status === 404;
}

/**
 * Which superseded clip files this project's media purge may delete
 * (MEDIA_PURGE_SCOPE): `all` only on the project that owns the media bucket
 * (prod). Staging shares the bucket and holds copies of prod's rows, so
 * anything else, unset included, deletes only the smoke's throwaway games'.
 */
export const MEDIA_PURGE_SCOPE = mediaPurgeScopeOf(Deno.env.get("MEDIA_PURGE_SCOPE"));
