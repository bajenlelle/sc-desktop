/**
 * Cloud game videos as rows: the copies a user has uploaded (RLS shows a
 * user only their own) and the plan meter behind "Keep a copy in the cloud".
 * Rows are written by the `game-video` edge function only; see
 * game-video-client.ts for the upload and playback calls.
 *
 * A desktop row goes uploading → ready. A browser row goes uploading (the
 * original) → converting (our converter makes the copy) → ready, and carries
 * the conversion's progress, the detected tip-off and the sync status.
 *
 * Each function takes a SupabaseClient so this module is isomorphic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";
import type {
  GameVideoAnchorKind,
  GameVideoConvertError,
  GameVideoOrigin,
  GameVideoSourceKind,
  GameVideoStatus,
  GameVideoSyncStatus,
} from "./game-video-wire";

export interface GameVideoRow {
  id: string;
  match_id: string;
  uploaded_by: string;
  org_id: string | null;
  status: GameVideoStatus;
  source_kind: GameVideoSourceKind;
  size_bytes: number | string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps?: number | null;
  source_fingerprint: string | null;
  created_at: string;
  ready_at: string | null;
  // Added by the browser-upload migration; optional so older row literals still type.
  origin?: GameVideoOrigin;
  source_name?: string | null;
  source_size_bytes?: number | string | null;
  anchor_kind?: GameVideoAnchorKind | null;
  anchor_label?: string | null;
  anchor_real_world_time?: string | null;
  convert_progress?: number | null;
  convert_attempts?: number;
  convert_error?: string | null;
  sync_status?: GameVideoSyncStatus | null;
  suggested_tipoff_seconds?: number | null;
  suggested_confidence?: number | null;
}

export interface GameVideo {
  id: string;
  matchId: string;
  uploadedBy: string;
  orgId: string | null;
  status: GameVideoStatus;
  sourceKind: GameVideoSourceKind;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sourceFingerprint: string | null;
  createdAt: string;
  readyAt: string | null;
  origin: GameVideoOrigin;
  /** Browser uploads: the original file's name and size. */
  sourceName: string | null;
  sourceSizeBytes: number | null;
  anchorKind: GameVideoAnchorKind | null;
  anchorLabel: string | null;
  anchorRealWorldTime: string | null;
  /** 0..1 while converting; null while the job waits for a converter. */
  convertProgress: number | null;
  convertAttempts: number;
  convertError: GameVideoConvertError | string | null;
  /** Null on desktop rows (see game-video-wire.ts). */
  syncStatus: GameVideoSyncStatus | null;
  suggestedTipoffSeconds: number | null;
  suggestedConfidence: number | null;
}

export const GAME_VIDEO_SELECT =
  "id, match_id, uploaded_by, org_id, status, source_kind, size_bytes, duration_seconds, width, height, fps, source_fingerprint, created_at, ready_at, " +
  "origin, source_name, source_size_bytes, anchor_kind, anchor_label, anchor_real_world_time, " +
  "convert_progress, convert_attempts, convert_error, sync_status, suggested_tipoff_seconds, suggested_confidence";

function optBig(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowToGameVideo(row: GameVideoRow): GameVideo {
  return {
    id: row.id,
    matchId: row.match_id,
    uploadedBy: row.uploaded_by,
    orgId: row.org_id,
    status: row.status,
    sourceKind: row.source_kind,
    sizeBytes: optBig(row.size_bytes),
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    fps: row.fps ?? null,
    sourceFingerprint: row.source_fingerprint,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    origin: row.origin ?? "desktop",
    sourceName: row.source_name ?? null,
    sourceSizeBytes: optBig(row.source_size_bytes),
    anchorKind: row.anchor_kind ?? null,
    anchorLabel: row.anchor_label ?? null,
    anchorRealWorldTime: row.anchor_real_world_time ?? null,
    convertProgress: row.convert_progress ?? null,
    convertAttempts: row.convert_attempts ?? 0,
    convertError: row.convert_error ?? null,
    syncStatus: row.sync_status ?? null,
    suggestedTipoffSeconds: row.suggested_tipoff_seconds ?? null,
    suggestedConfidence: row.suggested_confidence ?? null,
  };
}

/** The caller's copies, newest first; RLS keeps everyone else's out. */
export async function listMyGameVideos(
  supabase: SupabaseClient,
  opts: { status?: GameVideoStatus; orgId?: string | null } = {},
): Promise<GameVideo[]> {
  let query = supabase.from("game_videos").select(GAME_VIDEO_SELECT).order("created_at", { ascending: false });
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.orgId !== undefined) query = opts.orgId === null ? query.is("org_id", null) : query.eq("org_id", opts.orgId);
  const { data, error } = await query;
  // Never silently: an empty list from a failed query reads as "no copies".
  if (error) reportDbError("listMyGameVideos", error);
  if (error || !data) return [];
  return (data as unknown as GameVideoRow[]).map(rowToGameVideo);
}

/** The row that speaks for a game among several: ready, else converting, else the upload in progress, else a failed one. */
export function pickGameVideoRow<T extends { status: GameVideoStatus }>(rows: readonly T[]): T | null {
  return (
    rows.find((r) => r.status === "ready") ??
    rows.find((r) => r.status === "converting") ??
    rows.find((r) => r.status === "uploading") ??
    rows.find((r) => r.status === "failed") ??
    null
  );
}

/** The game's copy as its uploader sees it (pickGameVideoRow over the game's rows), or null. */
export async function getGameVideoForMatch(supabase: SupabaseClient, matchId: string): Promise<GameVideo | null> {
  const { data, error } = await supabase
    .from("game_videos")
    .select(GAME_VIDEO_SELECT)
    .eq("match_id", matchId)
    .order("created_at", { ascending: false });
  if (error) {
    reportDbError("getGameVideoForMatch", error);
    return null;
  }
  const row = pickGameVideoRow((data ?? []) as unknown as GameVideoRow[]);
  return row ? rowToGameVideo(row) : null;
}

/** True while the row will still change on its own: the converter is working or hasn't reported its sync yet. */
export function gameVideoIsSettling(video: GameVideo | null): boolean {
  if (!video) return false;
  if (video.status === "converting") return true;
  return video.status === "ready" && video.syncStatus === "pending";
}

export interface GameVideoQuota {
  /** The kill switch, app_config.cloud_video_enabled. */
  enabled: boolean;
  tier: string;
  maxGames: number;
  used: number;
}

/** The meter for a space: `get_game_video_quota`. Null when the call fails (then the function decides). */
export async function getGameVideoQuota(supabase: SupabaseClient, orgId: string | null): Promise<GameVideoQuota | null> {
  const { data, error } = await supabase.rpc("get_game_video_quota", { p_org_id: orgId });
  if (error) {
    reportDbError("getGameVideoQuota", error);
    return null;
  }
  const d = data as { enabled?: boolean; tier?: string; max_games?: number; used?: number } | null;
  if (!d) return null;
  return {
    enabled: d.enabled !== false,
    tier: d.tier ?? "free",
    maxGames: Number(d.max_games ?? 0),
    used: Number(d.used ?? 0),
  };
}

export type GameVideoBlock = "disabled" | "limit_reached" | "unavailable";

/**
 * Why a new copy can't start now, or null when it can. A meter that couldn't
 * be read blocks too: a server without the cloud video tables (prod before
 * its migration) must never get an eight-minute encode thrown at it.
 */
export function gameVideoBlock(quota: GameVideoQuota | null): GameVideoBlock | null {
  if (!quota) return "unavailable";
  if (!quota.enabled) return "disabled";
  if (quota.used >= quota.maxGames) return "limit_reached";
  return null;
}

/** The meter's line, remaining-oriented like the import meter. */
export function gameVideoQuotaLabel(quota: GameVideoQuota | null): string {
  if (!quota) return "Cloud copies aren't available right now";
  if (!quota.enabled) return "Cloud copies are turned off right now";
  if (quota.maxGames <= 0) return "Your plan doesn't include cloud copies";
  const left = Math.max(0, quota.maxGames - quota.used);
  return `${left} of ${quota.maxGames} cloud ${quota.maxGames === 1 ? "game" : "games"} left`;
}
