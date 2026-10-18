/**
 * Cloud game videos: the wire contract between the apps, the converter and
 * the `game-video` edge function, and the pure helpers all sides share (the
 * key scheme, the part plan, the S3 multipart XML, play-URL freshness).
 *
 * Imported by the Deno function via a relative path, so this file has NO
 * runtime imports and uses no DOM, Node or Deno globals.
 *
 * A copy is a whole game file re-encoded to 720p, uploaded in equal parts
 * (R2's rule: every part the same size except the last, at least 5 MiB)
 * through presigned part URLs, and played through a presigned GET. The
 * desktop encodes on the user's computer and uploads the copy itself; the
 * browser uploads the ORIGINAL to a source key and our converter (a
 * container the function starts) makes the copy, finds the tip-off and
 * reports back through the `job_*` actions.
 *
 * Object keys are `<prefix>/games/<matchId>/<videoId>.mp4` for copies and
 * `<prefix>/sources/<matchId>/<videoId>.<ext>` for originals, where the
 * prefix is the Supabase project ref, so staging and prod can share one
 * bucket and a project only ever touches its own objects.
 */

/** Every part the same size: 32 MiB. A 3 GB game is about 90 parts. */
export const GAME_VIDEO_PART_SIZE = 32 * 1024 * 1024;
/** The biggest file the function accepts, copy or original: 8 GiB. */
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

// ---------------------------------------------------------------------------
// Browser uploads and the converter
// ---------------------------------------------------------------------------

/** File extensions a browser may upload as an original; the converter probes the content anyway. */
export const GAME_VIDEO_SOURCE_EXTS = ["mp4", "mov", "m4v", "mkv", "webm", "ts"] as const;
/** The longest original the converter takes on: four hours covers any game with its pre- and post-game. */
export const GAME_VIDEO_MAX_SOURCE_SECONDS = 4 * 60 * 60;
/** How long the converter's presigned GET of the original lives. */
export const GAME_VIDEO_SOURCE_URL_SECONDS = 12 * 60 * 60;
/** A converting row whose heartbeat is older than this is considered dead and re-run by the sweep. */
export const GAME_VIDEO_HEARTBEAT_STALE_SECONDS = 10 * 60;
/** How many times a conversion is attempted before the row fails for good. */
export const GAME_VIDEO_MAX_ATTEMPTS = 3;
/** A detected tip-off at least this confident is applied to the game; weaker ones are only suggested. */
export const GAME_VIDEO_SYNC_APPLY_CONFIDENCE = 0.75;
/** How long a failed conversion keeps its original for a retry. */
export const GAME_VIDEO_SOURCE_KEEP_DAYS = 7;
/** How often the converter reports progress and renews its heartbeat. */
export const GAME_VIDEO_PROGRESS_INTERVAL_SECONDS = 30;

// ---------------------------------------------------------------------------
// Render jobs: shipping a playlist's clips (and, later, exporting it)
// ---------------------------------------------------------------------------

/** How many times a render job is attempted before it fails for good. */
export const RENDER_MAX_ATTEMPTS = 3;
/** How long the presigned URLs a render job works with live: enough for a long playlist. */
export const RENDER_URL_SECONDS = 2 * 60 * 60;
/** Render containers running at once across every user (conversions have their own cap; 15 + 4 stays under the Worker's 20). */
export const MAX_ACTIVE_RENDERS = 4;
/**
 * A shipped clip's key in the PUBLIC media bucket, as the desktop mints it and
 * presign-upload admits it (older desktop builds leave the `_s` segment out).
 */
export const CLIP_SHIP_KEY_RE = /^clips\/([A-Za-z0-9-]{1,64})\/\d{1,12}_pre-?\d{1,4}\.\d_post-?\d{1,4}\.\d(?:_s\d{1,6}\.\d)?\.mp4$/;

export type RenderJobKind = "ship" | "export";
export type RenderJobStatus = "queued" | "running" | "done" | "failed";

export type GameVideoStatus = "uploading" | "converting" | "ready" | "failed";
export type GameVideoSourceKind = "unknown" | "broadcast" | "own";
/** Who made the copy: the desktop on the user's computer, or our converter from a browser upload. */
export type GameVideoOrigin = "desktop" | "browser";
/**
 * The moment the sync anchors on: the Q1 tip-off (Genius games; what the
 * detector finds), the first made basket (Profixio games), or the match start
 * when a feed offers only that.
 */
export type GameVideoAnchorKind = "tipoff" | "first_basket" | "match_start";
/**
 * Where a browser-imported game's sync stands. NULL on desktop rows.
 *   pending    the converter hasn't reported yet
 *   applied    the converter wrote the sync (a confident detection or a confirmed hint); the user is asked to check it
 *   suggested  a weaker detection, stored on the row only (or the coach had synced the game already)
 *   not_found  the detector found nothing
 *   skipped    detection doesn't apply (first-basket anchor, no anchor time)
 *   confirmed  the user confirmed the applied or suggested time
 *   manual     the user set the time themselves
 */
export type GameVideoSyncStatus = "pending" | "applied" | "suggested" | "not_found" | "skipped" | "confirmed" | "manual";
/** What the converter's detection step concluded. */
export type GameVideoSyncOutcome = "confirmed" | "estimate" | "not_found" | "skipped";
/** Why a conversion failed, for the row's `convert_error` and the apps' copy. */
export type GameVideoConvertError =
  | "too_long"
  | "no_video_stream"
  | "unsupported_type"
  | "transcode_incomplete"
  | "source_unreadable"
  | "size_mismatch"
  | "upload_failed"
  | "gave_up"
  | "converter_unavailable";

export const GAME_VIDEO_CONVERT_ERRORS: readonly GameVideoConvertError[] = [
  "too_long",
  "no_video_stream",
  "unsupported_type",
  "transcode_incomplete",
  "source_unreadable",
  "size_mismatch",
  "upload_failed",
  "gave_up",
  "converter_unavailable",
];

/** The content fingerprint (lib/video-fingerprint.ts), restated here so this file stays import-free. */
export interface GameVideoFingerprint {
  version: number;
  durationMs: number;
  offsetsS: number[];
  hashes: string[];
  key: string;
}

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
const EXT = "[a-z0-9]{1,5}";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function gameVideoKey(prefix: string, matchId: string, videoId: string): string {
  return `${prefix}/games/${matchId}/${videoId}.mp4`;
}

/** The original's key for a browser upload; `ext` comes from sourceExtension(). */
export function gameVideoSourceKey(prefix: string, matchId: string, videoId: string, ext: string): string {
  return `${prefix}/sources/${matchId}/${videoId}.${ext}`;
}

/**
 * The lowercase extension of an uploaded file's name, when it is one the
 * converter takes ("Game.MP4" → "mp4"); null for anything else. The content
 * is probed anyway: the name only decides the key and the first refusal.
 */
export function sourceExtension(fileName: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(fileName.trim());
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return (GAME_VIDEO_SOURCE_EXTS as readonly string[]).includes(ext) ? ext : null;
}

/** True when `key` is a copy's key under exactly this prefix. */
export function isGameVideoCopyKey(key: string, prefix: string): boolean {
  if (!isValidKeyPrefix(prefix)) return false;
  return new RegExp(`^${escapeRegExp(prefix)}/games/${MATCH_ID}/${UUID}\\.mp4$`).test(key);
}

/** True when `key` is an original's key under exactly this prefix. */
export function isGameVideoSourceKey(key: string, prefix: string): boolean {
  if (!isValidKeyPrefix(prefix)) return false;
  return new RegExp(`^${escapeRegExp(prefix)}/sources/${MATCH_ID}/${UUID}\\.${EXT}$`).test(key);
}

/** True when `key` is any game video key (a copy or an original) under exactly this prefix. */
export function isGameVideoKey(key: string, prefix: string): boolean {
  return isGameVideoCopyKey(key, prefix) || isGameVideoSourceKey(key, prefix);
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
// Requests and responses: the apps
// ---------------------------------------------------------------------------

export type GameVideoAction =
  | "begin"
  | "sign_parts"
  | "complete"
  | "abort"
  | "remove"
  | "play"
  | "retry_convert"
  | "sync_set"
  | "purge"
  | "sweep"
  | "job_take"
  | "job_progress"
  | "job_sign_parts"
  | "job_done"
  | "job_failed"
  | "ship"
  | "render_take"
  | "render_progress"
  | "render_done"
  | "render_failed";

export interface GameVideoBeginRequest {
  action: "begin";
  matchId: string;
  /** The uploaded file's size: the finished copy for the desktop, the original for the browser. The part plan follows from it. */
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /**
   * Which file this is, so an interrupted upload resumes only for the same
   * one: the desktop sends the local file's content fingerprint key, the
   * browser a `wb1:` byte-sample key (lib/game-upload-core.ts).
   */
  fingerprintKey: string | null;
  /** Start over although a ready copy exists (it is swapped out when this one completes). */
  replace?: boolean;
  /** Omitted or "desktop": the copy is uploaded. "browser": the original is uploaded and the converter makes the copy. */
  origin?: GameVideoOrigin;
  /** Browser uploads: the file's name; its extension must be one of GAME_VIDEO_SOURCE_EXTS. */
  sourceName?: string;
  /** Browser uploads: what the sync anchors on, and the anchor's real-world time from the play-by-play (null when the feed has none). */
  anchorKind?: GameVideoAnchorKind;
  anchorLabel?: string | null;
  anchorRealWorldTime?: string | null;
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
  /** "ready" for a desktop copy; "converting" for a browser original, which the converter now turns into the copy. */
  status: "ready" | "converting";
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

/** Run the conversion again for a failed browser upload whose original is still kept. */
export interface GameVideoRetryConvertRequest {
  action: "retry_convert";
  videoId: string;
}

export interface GameVideoRetryConvertResponse {
  videoId: string;
  status: "converting";
}

/**
 * The uploader confirms the sync the converter applied or suggested
 * ("confirmed"; `seconds` defaults to that value) or sets it themselves
 * ("manual"; `seconds` required). Writes the game's sync point, a confirmed
 * hint for this recording and the row's sync status in one go.
 */
export interface GameVideoSyncSetRequest {
  action: "sync_set";
  videoId: string;
  status: "confirmed" | "manual";
  seconds?: number;
}

export interface GameVideoSyncSetResponse {
  videoId: string;
  syncStatus: GameVideoSyncStatus;
  /** The sync point's video time as written. */
  seconds: number;
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

// ---------------------------------------------------------------------------
// Requests and responses: the converter (header x-worker-secret; every write fenced by `attempt`)
// ---------------------------------------------------------------------------

export interface GameVideoJobTakeRequest {
  action: "job_take";
  videoId: string;
}

export interface GameVideoJobMatch {
  id: string;
  title: string;
  sourceGameId: string | null;
  leagueId: string | null;
  /** Profixio games anchor on the first basket: no tip-off detection. */
  isProfixio: boolean;
  anchorKind: GameVideoAnchorKind | null;
  anchorRealWorldTime: string | null;
}

export interface GameVideoJobTakeResponse {
  videoId: string;
  /** This run's attempt number: every later call must carry it back. */
  attempt: number;
  /** Presigned GET of the original, GAME_VIDEO_SOURCE_URL_SECONDS long. */
  sourceUrl: string;
  sourceSizeBytes: number;
  sourceName: string | null;
  /** The copy's multipart upload is open; parts are this big. */
  partSize: number;
  match: GameVideoJobMatch;
}

export interface GameVideoJobProgressRequest {
  action: "job_progress";
  videoId: string;
  attempt: number;
  /** 0..1 over the whole job (lib/game-video-convert.ts progressFraction). */
  progress: number;
}

export interface GameVideoJobSignPartsRequest {
  action: "job_sign_parts";
  videoId: string;
  attempt: number;
  partNumbers: number[];
}

export interface GameVideoJobSync {
  outcome: GameVideoSyncOutcome;
  /** The tip-off's video time for confirmed and estimate outcomes. */
  seconds?: number;
  /** 0..1 for an estimate (a confirmed hint needs none). */
  confidence?: number;
}

export interface GameVideoJobDoneRequest {
  action: "job_done";
  videoId: string;
  attempt: number;
  /** The copy's parts, every one. */
  parts: GameVideoPart[];
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  fingerprint: GameVideoFingerprint | null;
  sync: GameVideoJobSync;
}

export interface GameVideoJobDoneResponse {
  videoId: string;
  status: "ready";
  syncStatus: GameVideoSyncStatus;
}

export interface GameVideoJobFailedRequest {
  action: "job_failed";
  videoId: string;
  attempt: number;
  error: GameVideoConvertError | string;
  /** Another attempt may succeed (the sweep schedules it); false fails the row now. */
  retryable: boolean;
}

export interface GameVideoJobFailedResponse {
  videoId: string;
  status: "converting" | "failed";
  attempt: number;
}

/** Housekeeping for conversions, every 10 minutes from pg_cron: start waiting rows, re-run dead ones, expire old originals. */
export interface GameVideoSweepRequest {
  action: "sweep";
}

export interface GameVideoSweepResponse {
  examined: number;
  started: number;
  failed: number;
  expired: number;
}

// ---------------------------------------------------------------------------
// Requests and responses: render jobs (ship now; export in a later milestone)
// ---------------------------------------------------------------------------

/**
 * The owner asks for the playlist's clips to be cut from the cloud copies
 * into their own files, so people the playlist is shared with can watch.
 * Clips already cut for the current window are skipped; a game without a
 * cloud copy the owner may use is reported, not cut. A job already queued is
 * returned as is; one already running is marked to run again afterwards.
 */
export interface ShipRequest {
  action: "ship";
  playlistId: string;
}

export interface ShipSkipped {
  matchId: string;
  eventId: number;
  reason: "up_to_date" | "no_time";
}

export interface ShipNoCopy {
  matchId: string;
  eventIds: number[];
}

export interface ShipResponse {
  /** Null when nothing needed cutting (then `status` is "done"). */
  jobId: string | null;
  status: RenderJobStatus;
  /** Clips the job will cut. */
  total: number;
  skipped: ShipSkipped[];
  noCopy: ShipNoCopy[];
  /** The request landed on a running job, which will run again when it finishes. */
  requeued: boolean;
}

export interface RenderTakeRequest {
  action: "render_take";
  jobId: string;
}

/** One clip to cut: the window in the copy's timeline and where the file goes. */
export interface RenderShipClip {
  clipId: string;
  matchId: string;
  eventId: number;
  /** The game_videos row whose copy to cut from; its URL is in `copies`. */
  videoId: string;
  start: number;
  end: number;
  /** The public key (clipShipKey) the file is stored under. */
  key: string;
  /** Presigned PUT for that key, Content-Type video/mp4 signed in. */
  putUrl: string;
}

export interface RenderTakeResponse {
  jobId: string;
  /** This run's attempt number: every later call must carry it back. */
  attempt: number;
  kind: RenderJobKind;
  /** Presigned GET URLs of the copies, by game_videos id. */
  copies: Record<string, { url: string }>;
  clips: RenderShipClip[];
  /** The public base the keys are served from (R2_MEDIA_PUBLIC_URL). */
  publicBase: string;
}

export interface RenderProgressRequest {
  action: "render_progress";
  jobId: string;
  attempt: number;
  /** 0..1 over the job's clips. */
  progress: number;
}

export interface RenderClipResult {
  matchId: string;
  eventId: number;
  key: string;
  ok: boolean;
  error?: string;
}

export interface RenderDoneRequest {
  action: "render_done";
  jobId: string;
  attempt: number;
  results: RenderClipResult[];
}

export interface RenderDoneResponse {
  jobId: string;
  status: "done";
  shipped: number;
  failed: number;
  /** Clips whose window changed while the job ran: their file was not used; the requeue cuts them again. */
  superseded: number;
}

export interface RenderFailedRequest {
  action: "render_failed";
  jobId: string;
  attempt: number;
  error: string;
  /** Another attempt may succeed (the sweep schedules it); false fails the job now. */
  retryable: boolean;
}

export interface RenderFailedResponse {
  jobId: string;
  status: RenderJobStatus;
  attempt: number;
}

export type GameVideoRequest =
  | GameVideoBeginRequest
  | GameVideoSignPartsRequest
  | GameVideoCompleteRequest
  | GameVideoAbortRequest
  | GameVideoRemoveRequest
  | GameVideoPlayRequest
  | GameVideoRetryConvertRequest
  | GameVideoSyncSetRequest
  | GameVideoPurgeRequest
  | GameVideoSweepRequest
  | GameVideoJobTakeRequest
  | GameVideoJobProgressRequest
  | GameVideoJobSignPartsRequest
  | GameVideoJobDoneRequest
  | GameVideoJobFailedRequest
  | ShipRequest
  | RenderTakeRequest
  | RenderProgressRequest
  | RenderDoneRequest
  | RenderFailedRequest;

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
  /** The file's name isn't one of GAME_VIDEO_SOURCE_EXTS. */
  "unsupported_type",
  /** Browser uploads need the converter, and this project has none configured. */
  "converter_unavailable",
  /** A retry after the original was deleted (GAME_VIDEO_SOURCE_KEEP_DAYS). */
  "source_expired",
  /** The game's sync is the coach's own: the web can't change it here. */
  "sync_locked",
  "bad_worker_secret",
  /** A converter call carrying an attempt number that is no longer the row's. */
  "stale_attempt",
  /** job_take on a row another converter holds. */
  "job_busy",
  /** Shipping needs the media bucket's credentials and the converter, and this project has neither configured. */
  "renderer_unavailable",
] as const;

export type GameVideoError = (typeof GAME_VIDEO_ERRORS)[number];
