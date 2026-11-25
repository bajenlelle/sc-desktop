/**
 * The hard cuts found in a recording, shared by its fingerprint
 * (supabase/migrations/20261125100000_video_cut_scans.sql). Only the
 * fingerprint and the cut times are sent; what they mean for a game is
 * worked out in lib/video-jumps.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFingerprintMatch, type VideoFingerprint } from "./video-fingerprint";

/** The scene score above which a frame counts as a hard cut (ffmpeg's `select='gt(scene,…)'`). */
export const CUT_THRESHOLD = 0.3;

export interface VideoCutScan {
  cuts: number[];
  threshold: number;
  isMine: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The best scan of this recording that passes the fingerprint match rule; null when it hasn't been searched. */
export async function findVideoCutScan(supabase: SupabaseClient, fp: VideoFingerprint): Promise<VideoCutScan | null> {
  const { data, error } = await supabase.rpc("find_video_cut_scans", { p_duration_ms: fp.durationMs, p_hashes: fp.hashes });
  if (error) throw new Error(`Failed to look up the video's cuts: ${error.message}`);
  for (const r of Array.isArray(data) ? data : []) {
    if (!isObj(r) || !Array.isArray(r.cuts) || !Array.isArray(r.distances)) continue;
    const distances = r.distances.filter((d): d is number => typeof d === "number");
    if (!isFingerprintMatch(distances, typeof r.duration_delta_ms === "number" ? r.duration_delta_ms : 0)) continue;
    return {
      cuts: r.cuts.filter((c): c is number => typeof c === "number" && Number.isFinite(c)),
      threshold: typeof r.threshold === "number" ? r.threshold : CUT_THRESHOLD,
      isMine: r.is_mine === true,
    };
  }
  return null;
}

/** Shares a finished search of the whole recording. */
export async function saveVideoCutScan(supabase: SupabaseClient, fp: VideoFingerprint, cuts: readonly number[], threshold = CUT_THRESHOLD): Promise<void> {
  const { error } = await supabase.rpc("save_video_cut_scan", {
    p_fingerprint_key: fp.key,
    p_duration_ms: fp.durationMs,
    p_hashes: fp.hashes,
    p_cuts: [...cuts].sort((a, b) => a - b).slice(0, 2000),
    p_threshold: threshold,
  });
  if (error) throw new Error(`Failed to save the video's cuts: ${error.message}`);
}
