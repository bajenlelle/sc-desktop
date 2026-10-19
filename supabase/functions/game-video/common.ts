// Scoutable — cloud game videos Edge Function: what index.ts (uploads,
// conversions) and render.ts (server-cut clips) share. Configuration from the
// function's secrets, the response helpers, request-field validation, the
// two R2 clients (the PRIVATE game-video bucket behind guardKey(), the PUBLIC
// media bucket behind guardClipKey()) and the SQL error mapping.
//
// The media bucket's credentials are the R2_* secrets presign-upload uses:
// function secrets are project-wide, so this function sees the same names.
// Without them `ship` and `render_take` answer renderer_unavailable and
// everything else keeps working.

import { AwsClient } from "npm:aws4fetch@1.0.20";
import {
  CLIP_SHIP_KEY_RE,
  GAME_VIDEO_HEARTBEAT_STALE_SECONDS,
  isGameVideoKey,
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

/** A key this function must never touch: another project's prefix, or a clip key outside the desktop's scheme. */
export class ForeignKeyError extends Error {}

/** Every private-bucket call goes through this: a key outside this project's prefix is never touched. */
export function guardKey(key: string): string {
  if (!isGameVideoKey(key, KEY_PREFIX)) throw new ForeignKeyError(key);
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

// ---------------------------------------------------------------------------
// R2 (S3 API): the PUBLIC media bucket, for shipped clips
// ---------------------------------------------------------------------------

/** True when the media bucket's secrets are all there; `ship` and `render_take` refuse otherwise. */
export function mediaConfigured(): boolean {
  return !!(MEDIA_ENDPOINT && MEDIA_BUCKET && MEDIA_ACCESS_KEY_ID && MEDIA_SECRET_ACCESS_KEY && MEDIA_PUBLIC_URL);
}

const media = new AwsClient({
  accessKeyId: MEDIA_ACCESS_KEY_ID,
  secretAccessKey: MEDIA_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

/** Every media-bucket key is a shipped clip's, in the desktop's scheme (presign-upload admits the same). */
export function guardClipKey(key: string): string {
  if (!CLIP_SHIP_KEY_RE.test(key)) throw new ForeignKeyError(key);
  return key;
}

/**
 * A presigned PUT for a clip key with the Content-Type signed in, so the URL
 * can only ever upload video/mp4. `allHeaders` is required: aws4fetch treats
 * content-type as unsignable by default and would silently drop it (see
 * presign-upload).
 */
export async function presignMediaPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
  const url = new URL(`${MEDIA_ENDPOINT}/${MEDIA_BUCKET}/${guardClipKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await media.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}
