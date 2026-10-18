/**
 * Cloud game videos as rows: the copies a user has uploaded (RLS shows a
 * user only their own) and the plan meter behind "Keep a copy in the cloud".
 * Rows are written by the `game-video` edge function only; see
 * game-video-client.ts for the upload and playback calls.
 *
 * Each function takes a SupabaseClient so this module is isomorphic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";
import type { GameVideoSourceKind, GameVideoStatus } from "./game-video-wire";

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
  source_fingerprint: string | null;
  created_at: string;
  ready_at: string | null;
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
  sourceFingerprint: string | null;
  createdAt: string;
  readyAt: string | null;
}

export const GAME_VIDEO_SELECT =
  "id, match_id, uploaded_by, org_id, status, source_kind, size_bytes, duration_seconds, width, height, source_fingerprint, created_at, ready_at";

export function rowToGameVideo(row: GameVideoRow): GameVideo {
  const size = row.size_bytes === null ? null : Number(row.size_bytes);
  return {
    id: row.id,
    matchId: row.match_id,
    uploadedBy: row.uploaded_by,
    orgId: row.org_id,
    status: row.status,
    sourceKind: row.source_kind,
    sizeBytes: size !== null && Number.isFinite(size) ? size : null,
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    sourceFingerprint: row.source_fingerprint,
    createdAt: row.created_at,
    readyAt: row.ready_at,
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
  return (data as GameVideoRow[]).map(rowToGameVideo);
}

/** The game's copy as its uploader sees it: ready first, else the upload in progress, else a failed one, else null. */
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
  const rows = (data ?? []) as GameVideoRow[];
  const row =
    rows.find((r) => r.status === "ready") ??
    rows.find((r) => r.status === "uploading") ??
    rows.find((r) => r.status === "failed") ??
    null;
  return row ? rowToGameVideo(row) : null;
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

export type GameVideoBlock = "disabled" | "limit_reached";

/** Why a new copy can't start now, or null when it can (or when the meter is unknown). */
export function gameVideoBlock(quota: GameVideoQuota | null): GameVideoBlock | null {
  if (!quota) return null;
  if (!quota.enabled) return "disabled";
  if (quota.used >= quota.maxGames) return "limit_reached";
  return null;
}

/** The meter's line, remaining-oriented like the import meter. */
export function gameVideoQuotaLabel(quota: GameVideoQuota): string {
  if (!quota.enabled) return "Cloud copies are turned off right now";
  if (quota.maxGames <= 0) return "Your plan doesn't include cloud copies";
  const left = Math.max(0, quota.maxGames - quota.used);
  return `${left} of ${quota.maxGames} cloud ${quota.maxGames === 1 ? "game" : "games"} left`;
}
