/**
 * Shared tip-off offsets per recording ("video sync hints"). Every signed-in
 * user who imports the same recording — by content fingerprint, so any
 * rendition of the same stream — gets the offset another user confirmed or
 * the detector found. One row per (user, recording), written only through
 * RPCs; the SQL side prefilters by duration and total distance, the match rule
 * is applied here so its thresholds live next to their tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFingerprintMatch, type VideoFingerprint } from "./video-fingerprint";

export type HintMethod = "auto" | "confirmed";

export interface VideoSyncHintCandidate {
  id: string;
  tipoffVideoTime: number;
  method: HintMethod;
  confidence: number | null;
  sourceGameId: string | null;
  isMine: boolean;
  /** Per-offset Hamming distance to the looked-up fingerprint (common prefix). */
  distances: number[];
  durationDeltaMs: number;
  createdAt: string;
}

/** Hints whose times are this close count as agreeing. */
export const HINT_AGREEMENT_S = 1.5;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function rowToCandidate(r: unknown): VideoSyncHintCandidate | null {
  if (!isObj(r)) return null;
  if (typeof r.id !== "string" || typeof r.tipoff_video_time !== "number") return null;
  if (r.method !== "auto" && r.method !== "confirmed") return null;
  if (!Array.isArray(r.distances) || !r.distances.every((d) => typeof d === "number")) return null;
  return {
    id: r.id,
    tipoffVideoTime: r.tipoff_video_time,
    method: r.method,
    confidence: typeof r.confidence === "number" ? r.confidence : null,
    sourceGameId: typeof r.source_game_id === "string" ? r.source_game_id : null,
    isMine: r.is_mine === true,
    distances: r.distances as number[],
    durationDeltaMs: typeof r.duration_delta_ms === "number" ? r.duration_delta_ms : 0,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/** Candidates for this recording that pass the fingerprint match rule, best-ranked first by the server. */
export async function findVideoSyncHints(
  supabase: SupabaseClient,
  fp: VideoFingerprint,
  sourceGameId?: string,
): Promise<VideoSyncHintCandidate[]> {
  const { data, error } = await supabase.rpc("find_video_sync_hints", {
    p_duration_ms: fp.durationMs,
    p_hashes: fp.hashes,
    p_source_game_id: sourceGameId ?? null,
  });
  if (error) throw new Error(`Failed to look up sync hints: ${error.message}`);
  if (!Array.isArray(data)) return [];
  return data
    .map(rowToCandidate)
    .filter((c): c is VideoSyncHintCandidate => c !== null)
    .filter((c) => isFingerprintMatch(c.distances, c.durationDeltaMs));
}

/**
 * Which hint to offer: never one recorded for a different game; confirmed
 * before automatic; then the time most other hints agree with; then the newest.
 * `agreement` is the number of hints within HINT_AGREEMENT_S of the chosen one.
 */
export function pickBestHint(
  candidates: VideoSyncHintCandidate[],
  sourceGameId?: string,
): { hint: VideoSyncHintCandidate; agreement: number } | null {
  const usable = candidates.filter((c) => !c.sourceGameId || !sourceGameId || c.sourceGameId === sourceGameId);
  if (usable.length === 0) return null;
  const agreementOf = (c: VideoSyncHintCandidate) =>
    usable.filter((o) => Math.abs(o.tipoffVideoTime - c.tipoffVideoTime) <= HINT_AGREEMENT_S).length;
  const ranked = usable
    .map((c) => ({ c, agreement: agreementOf(c) }))
    .sort((a, b) => {
      const m = Number(a.c.method !== "confirmed") - Number(b.c.method !== "confirmed");
      if (m !== 0) return m;
      if (a.agreement !== b.agreement) return b.agreement - a.agreement;
      return b.c.createdAt.localeCompare(a.c.createdAt);
    });
  return { hint: ranked[0].c, agreement: ranked[0].agreement };
}

/** Writes or upgrades the caller's own hint for this recording; returns the row id. */
export async function saveVideoSyncHint(
  supabase: SupabaseClient,
  input: { fp: VideoFingerprint; sourceGameId?: string; tipoffVideoTime: number; method: HintMethod; confidence?: number },
): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_video_sync_hint", {
    p_fingerprint_key: input.fp.key,
    p_duration_ms: input.fp.durationMs,
    p_hashes: input.fp.hashes,
    p_source_game_id: input.sourceGameId ?? null,
    p_tipoff_video_time: input.tipoffVideoTime,
    p_method: input.method,
    p_confidence: input.confidence ?? null,
  });
  if (error) throw new Error(`Failed to save sync hint: ${error.message}`);
  return data as string;
}
