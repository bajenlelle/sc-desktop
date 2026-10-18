/**
 * Cloud game videos: the wire contract between the apps and the `game-video`
 * edge function, and the pure helpers both sides share (the key scheme, the
 * part plan, the S3 multipart XML, play-URL freshness).
 *
 * Imported by the Deno function via a relative path, so this file has NO
 * runtime imports and uses no DOM, Node or Deno globals.
 *
 * A copy is a whole game file re-encoded to 720p by the desktop, uploaded in
 * equal parts (R2's rule: every part the same size except the last, at least
 * 5 MiB) through presigned part URLs, and played through a presigned GET.
 * Object keys are `<prefix>/games/<matchId>/<videoId>.mp4`, where the prefix
 * is the Supabase project ref, so staging and prod can share one bucket and
 * a project only ever touches its own objects.
 */

/** Every part the same size: 32 MiB. A 3 GB game is about 90 parts. */
export const GAME_VIDEO_PART_SIZE = 32 * 1024 * 1024;
/** The biggest copy the function accepts: 8 GiB, about four hours of 720p at the encoder's ceiling. */
export const GAME_VIDEO_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** S3 and R2 stop at 10,000 parts; with 32 MiB parts the size cap comes long before. */
export const GAME_VIDEO_MAX_PARTS = 10_000;
/** The most part URLs one sign_parts call hands out. */
export const GAME_VIDEO_SIGN_BATCH = 50;
/** How long a presigned part URL lives. */
export const GAME_VIDEO_PART_URL_SECONDS = 60 * 60;
/** How long a presigned play URL lives: a long evening of viewing. */
export const GAME_VIDEO_PLAY_URL_SECONDS = 12 * 60 * 60;
/** A play URL this close to expiry is refreshed before use. */
export const GAME_VIDEO_URL_MARGIN_SECONDS = 10 * 60;

export type GameVideoStatus = "uploading" | "ready" | "failed";
export type GameVideoSourceKind = "unknown" | "broadcast" | "own";

/** One uploaded part, as S3 names it. The ETag is kept bare (no quotes). */
export interface GameVideoPart {
  partNumber: number;
  etag: string;
}

export interface PartPlan {
  partSize: number;
  count: number;
}

/** How a file of `sizeBytes` splits into parts. Throws `invalid_size` or `too_large`. */
export function planParts(sizeBytes: number, partSize: number = GAME_VIDEO_PART_SIZE): PartPlan {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new Error("invalid_size");
  if (sizeBytes > GAME_VIDEO_MAX_BYTES) throw new Error("too_large");
  const count = Math.ceil(sizeBytes / partSize);
  if (count > GAME_VIDEO_MAX_PARTS) throw new Error("too_large");
  return { partSize, count };
}

/** The byte range of part `partNumber` (1-based) in a file of `sizeBytes`. */
export function partRange(partNumber: number, plan: PartPlan, sizeBytes: number): { offset: number; length: number } {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.count) throw new Error("invalid_part");
  const offset = (partNumber - 1) * plan.partSize;
  return { offset, length: Math.min(plan.partSize, sizeBytes - offset) };
}

/** The part numbers still to upload, in order. */
export function missingParts(count: number, completed: readonly { partNumber: number }[]): number[] {
  const done = new Set(completed.map((p) => p.partNumber));
  const out: number[] = [];
  for (let n = 1; n <= count; n++) if (!done.has(n)) out.push(n);
  return out;
}

/** True when `parts` holds every part 1..count exactly once. */
export function partsComplete(parts: readonly GameVideoPart[], count: number): boolean {
  if (parts.length !== count) return false;
  const seen = new Set<number>();
  for (const p of parts) {
    if (!Number.isInteger(p.partNumber) || p.partNumber < 1 || p.partNumber > count || !p.etag) return false;
    if (seen.has(p.partNumber)) return false;
    seen.add(p.partNumber);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The project ref in a Supabase URL ("https://abcdefghijklmnopqrst.supabase.co"
 * → "abcdefghijklmnopqrst"), or null for anything else, such as a local
 * stack's kong URL. The function fails closed on null.
 */
export function projectRefFromUrl(supabaseUrl: string): string | null {
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in|red|net)(?:[/:?#]|$)/i.exec(supabaseUrl.trim());
  return m ? m[1].toLowerCase() : null;
}

/** A key prefix: lowercase letters, digits and dashes, as a project ref is. */
export function isValidKeyPrefix(prefix: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(prefix);
}

// The same match id shape presign-upload's CLIP_KEY accepts: a Genius numeric
// string, a legacy gameUuid, a Profixio id or "demo-<uuid>".
const MATCH_ID = "[A-Za-z0-9-]{1,64}";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function gameVideoKey(prefix: string, matchId: string, videoId: string): string {
  return `${prefix}/games/${matchId}/${videoId}.mp4`;
}

/** True when `key` is a game video key under exactly this prefix. */
export function isGameVideoKey(key: string, prefix: string): boolean {
  if (!isValidKeyPrefix(prefix)) return false;
  return new RegExp(`^${escapeRegExp(prefix)}/games/${MATCH_ID}/${UUID}\\.mp4$`).test(key);
}

// ---------------------------------------------------------------------------
// S3 multipart XML
// ---------------------------------------------------------------------------

/** S3 quotes ETags ("abc"); rows and requests keep them bare. */
export function bareEtag(etag: string): string {
  return etag.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface ListPartsPage {
  parts: GameVideoPart[];
  /** Set when the listing was cut short: ask again from this marker. */
  nextPartNumberMarker: number | null;
}

/** The parts in a ListParts response. S3 escapes the ETag's quotes (`&quot;`) and may put the ETag before the number. */
export function parseListParts(xml: string): ListPartsPage {
  const parts: GameVideoPart[] = [];
  const partRe = /<Part>([\s\S]*?)<\/Part>/g;
  let m: RegExpExecArray | null;
  while ((m = partRe.exec(xml))) {
    const body = m[1];
    const num = /<PartNumber>\s*(\d+)\s*<\/PartNumber>/.exec(body);
    const etag = /<ETag>\s*([\s\S]*?)\s*<\/ETag>/.exec(body);
    if (!num || !etag) continue;
    const bare = bareEtag(decodeXml(etag[1]));
    if (!bare) continue;
    parts.push({ partNumber: Number(num[1]), etag: bare });
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const next = /<NextPartNumberMarker>\s*(\d+)\s*<\/NextPartNumberMarker>/.exec(xml);
  return { parts, nextPartNumberMarker: truncated && next ? Number(next[1]) : null };
}

/** The body of a CompleteMultipartUpload request: parts in order, ETags quoted as S3 wants them. */
export function completeMultipartXml(parts: readonly GameVideoPart[]): string {
  const body = [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>&quot;${escapeXml(bareEtag(p.etag))}&quot;</ETag></Part>`)
    .join("");
  return `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</CompleteMultipartUpload>`;
}

/** The S3 error code in an XML error body ("NoSuchUpload", "NoSuchKey"), or null. */
export function s3ErrorCode(xml: string): string | null {
  const m = /<Code>\s*([A-Za-z0-9]+)\s*<\/Code>/.exec(xml);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Play URLs
// ---------------------------------------------------------------------------

/** True while a presigned URL has more than the margin left before it expires. */
export function isSignedUrlFresh(
  expiresAt: string | number,
  now: number = Date.now(),
  marginSeconds: number = GAME_VIDEO_URL_MARGIN_SECONDS,
): boolean {
  const t = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
  return Number.isFinite(t) && t - now > marginSeconds * 1000;
}

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

export type GameVideoAction = "begin" | "sign_parts" | "complete" | "abort" | "remove" | "play" | "purge";

export interface GameVideoBeginRequest {
  action: "begin";
  matchId: string;
  /** The finished copy's size; the part plan follows from it. */
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** fingerprint_key of the local file the copy was made from; an interrupted upload resumes only for the same file. */
  fingerprintKey: string | null;
  /** Start over although a ready copy exists (it is swapped out when this one completes). */
  replace?: boolean;
}

export interface GameVideoBeginResponse {
  videoId: string;
  partSize: number;
  partCount: number;
  /** Parts already on the server when an interrupted upload resumes. */
  completedParts: GameVideoPart[];
  resumed: boolean;
}

export interface GameVideoSignPartsRequest {
  action: "sign_parts";
  videoId: string;
  partNumbers: number[];
}

export interface GameVideoSignPartsResponse {
  urls: { partNumber: number; url: string }[];
  expiresAt: string;
}

export interface GameVideoCompleteRequest {
  action: "complete";
  videoId: string;
  parts: GameVideoPart[];
}

export interface GameVideoCompleteResponse {
  videoId: string;
  status: "ready";
}

export interface GameVideoAbortRequest {
  action: "abort";
  videoId: string;
}

export interface GameVideoRemoveRequest {
  action: "remove";
  videoId: string;
}

export interface GameVideoPlayRequest {
  action: "play";
  matchId: string;
}

export interface GameVideoPlayResponse {
  videoId: string;
  url: string;
  expiresAt: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export interface GameVideoPurgeRequest {
  action: "purge";
}

export interface GameVideoPurgeResponse {
  deleted: number;
  aborted: number;
  /** Keys outside this project's prefix, left in the queue and reported. */
  refused: number;
  remaining: number;
}

export type GameVideoRequest =
  | GameVideoBeginRequest
  | GameVideoSignPartsRequest
  | GameVideoCompleteRequest
  | GameVideoAbortRequest
  | GameVideoRemoveRequest
  | GameVideoPlayRequest
  | GameVideoPurgeRequest;

/** Every `{ error }` token the function answers with. */
export const GAME_VIDEO_ERRORS = [
  "method_not_allowed",
  "server_misconfigured",
  "not_authenticated",
  "invalid_json",
  "invalid_request",
  "not_owner",
  "not_found",
  "feature_disabled",
  "limit_reached",
  "too_large",
  "already_ready",
  "wrong_status",
  "size_mismatch",
  "storage_failed",
  "lookup_failed",
  "bad_purge_secret",
  /** The row's key belongs to another project's prefix: never touched. */
  "foreign_object",
] as const;

export type GameVideoError = (typeof GAME_VIDEO_ERRORS)[number];
