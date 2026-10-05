/**
 * Typed client for the `tipoff-detect` edge function, which reads scoreboard
 * clocks from still frames with Claude. The function is stateless; all
 * scheduling lives in `tipoff-detect.ts`. Same invoke/error-token pattern as
 * `genius-client.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrameReading, FrameView, OverlayBox } from "./tipoff-detect";

export type TipoffDetectResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface DetectUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ReadFramesRequest {
  frames: { jpegBase64: string }[];
  view: FrameView;
  periodLengthS: number;
}

export interface ReadFramesResponse {
  readings: FrameReading[];
  usage: DetectUsage;
}

export interface LocateOverlayRequest {
  frames: { jpegBase64: string }[];
}

export interface LocateOverlayResponse {
  found: boolean;
  box: OverlayBox | null;
  confidence: number;
  elements: string[];
  usage: DetectUsage;
}

async function invokeTipoffDetect<T>(supabase: SupabaseClient, body: Record<string, unknown>): Promise<TipoffDetectResult<T>> {
  const { data, error } = await supabase.functions.invoke("tipoff-detect", { body });
  if (error) {
    let token = "request_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        token = (await ctx.json())?.error ?? token;
      } catch {
        // keep the generic token
      }
    }
    return { ok: false, error: token };
  }
  return { ok: true, data: data as T };
}

export function readFrames(supabase: SupabaseClient, req: ReadFramesRequest): Promise<TipoffDetectResult<ReadFramesResponse>> {
  return invokeTipoffDetect<ReadFramesResponse>(supabase, { action: "read_frames", view: req.view, periodLengthS: req.periodLengthS, frames: req.frames });
}

export function locateOverlay(supabase: SupabaseClient, req: LocateOverlayRequest): Promise<TipoffDetectResult<LocateOverlayResponse>> {
  return invokeTipoffDetect<LocateOverlayResponse>(supabase, { action: "locate_overlay", frames: req.frames });
}
