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
  GameVideoSignPartsRequest,
  GameVideoSignPartsResponse,
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
