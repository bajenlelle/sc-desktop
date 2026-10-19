/**
 * Client for the `game-video` edge function: the only road to the private
 * game-video bucket from an app. The function holds the R2 credentials,
 * checks that the caller owns the game and is within their plan's cap, and
 * brokers the multipart upload with presigned part URLs; playback goes
 * through a presigned GET it mints for the uploader.
 *
 * Thin wrappers over invokeEdgeFunction so callers branch on the function's
 * snake-case tokens (`limit_reached`, `already_ready`) rather than on HTTP.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction, type FunctionResult } from "./edge-function";
import type {
  GameVideoAbortRequest,
  GameVideoBeginRequest,
  GameVideoBeginResponse,
  GameVideoCompleteRequest,
  GameVideoCompleteResponse,
  GameVideoPlayResponse,
  GameVideoRemoveRequest,
  GameVideoRetryConvertRequest,
  GameVideoRetryConvertResponse,
  GameVideoSignPartsRequest,
  GameVideoSignPartsResponse,
  GameVideoSyncSetRequest,
  GameVideoSyncSetResponse,
  ShipResponse,
  ExportRequest,
  ExportResponse,
  ExportLinkResponse,
  RenderCancelResponse,
} from "./game-video-wire";

export const GAME_VIDEO_FUNCTION = "game-video";

type Body<T extends { action: string }> = Omit<T, "action">;

export function beginGameVideo(
  supabase: SupabaseClient,
  body: Body<GameVideoBeginRequest>,
): Promise<FunctionResult<GameVideoBeginResponse>> {
  return invokeEdgeFunction<GameVideoBeginResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "begin", ...body });
}

export function signGameVideoParts(
  supabase: SupabaseClient,
  body: Body<GameVideoSignPartsRequest>,
): Promise<FunctionResult<GameVideoSignPartsResponse>> {
  return invokeEdgeFunction<GameVideoSignPartsResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "sign_parts", ...body });
}

export function completeGameVideo(
  supabase: SupabaseClient,
  body: Body<GameVideoCompleteRequest>,
): Promise<FunctionResult<GameVideoCompleteResponse>> {
  return invokeEdgeFunction<GameVideoCompleteResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "complete", ...body });
}

export function abortGameVideo(
  supabase: SupabaseClient,
  body: Body<GameVideoAbortRequest>,
): Promise<FunctionResult<{ videoId: string }>> {
  return invokeEdgeFunction<{ videoId: string }>(supabase, GAME_VIDEO_FUNCTION, { action: "abort", ...body });
}

export function removeGameVideo(
  supabase: SupabaseClient,
  body: Body<GameVideoRemoveRequest>,
): Promise<FunctionResult<{ videoId: string }>> {
  return invokeEdgeFunction<{ videoId: string }>(supabase, GAME_VIDEO_FUNCTION, { action: "remove", ...body });
}

/** A presigned play URL for the game's ready copy; `not_found` unless the caller uploaded it. */
export function playGameVideo(
  supabase: SupabaseClient,
  matchId: string,
): Promise<FunctionResult<GameVideoPlayResponse>> {
  return invokeEdgeFunction<GameVideoPlayResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "play", matchId });
}

/** Run a failed browser upload's conversion again; `source_expired` once the original is gone. */
export function retryGameVideoConvert(
  supabase: SupabaseClient,
  body: Body<GameVideoRetryConvertRequest>,
): Promise<FunctionResult<GameVideoRetryConvertResponse>> {
  return invokeEdgeFunction<GameVideoRetryConvertResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "retry_convert", ...body });
}

/**
 * Cut the playlist's clips into their own files from the cloud copies, so the
 * people it is shared with can watch. `renderer_unavailable` when the project
 * has no converter configured; `not_owner` for anyone but the owner.
 */
export function shipPlaylist(supabase: SupabaseClient, playlistId: string): Promise<FunctionResult<ShipResponse>> {
  return invokeEdgeFunction<ShipResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "ship", playlistId });
}

/**
 * Render one MP4 of the playlist on the server: a download or a highlight
 * link (see ExportRequest). `upgrade_required` on a free plan,
 * `nothing_to_export` when no clip has a cloud copy, `renderer_unavailable`
 * when the project has no renderer.
 */
export function exportPlaylist(supabase: SupabaseClient, request: Omit<ExportRequest, "action">): Promise<FunctionResult<ExportResponse>> {
  return invokeEdgeFunction<ExportResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "export", ...request });
}

/** A fresh link that saves a finished download export; `export_expired` once its file is gone. */
export function exportDownloadLink(supabase: SupabaseClient, jobId: string): Promise<FunctionResult<ExportLinkResponse>> {
  return invokeEdgeFunction<ExportLinkResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "export_link", jobId });
}

/** Stop a queued or running render of the owner's. */
export function cancelRender(supabase: SupabaseClient, jobId: string): Promise<FunctionResult<RenderCancelResponse>> {
  return invokeEdgeFunction<RenderCancelResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "render_cancel", jobId });
}

/** Confirm the sync the converter found, or set it by hand; `sync_locked` when the coach's own sync is in place. */
export function setGameVideoSync(
  supabase: SupabaseClient,
  body: Body<GameVideoSyncSetRequest>,
): Promise<FunctionResult<GameVideoSyncSetResponse>> {
  return invokeEdgeFunction<GameVideoSyncSetResponse>(supabase, GAME_VIDEO_FUNCTION, { action: "sync_set", ...body });
}
