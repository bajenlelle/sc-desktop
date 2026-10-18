/**
 * The tip-off side of a job: a session as the tip-off bot, the shared-hint
 * lookup by content fingerprint, and the detector over the original with
 * frames from the local ffmpeg. The nightly job does the same for BasketTV
 * replays; the pieces are in @scoutable/node-video.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { detectDeps } from "@scoutable/node-video/lib/detect-local";
import type { Probe } from "@scoutable/node-video/lib/ffmpeg";
import { runTipoffDetection } from "@scoutable/shared/lib/tipoff-detect";
import type { GameVideoJobMatch, GameVideoJobSync } from "@scoutable/shared/lib/game-video-wire";
import type { VideoFingerprint } from "@scoutable/shared/lib/video-fingerprint";
import { findVideoSyncHints, pickBestHint, saveVideoSyncHint } from "@scoutable/shared/lib/video-sync-hints-db";
import type { Logger } from "./log.ts";
import { detectStageFraction, syncFromDetection, syncFromHint } from "./sync.ts";

export interface BotCredentials {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}

/**
 * A fresh session as the bot. Sessions are short-lived here (a lookup, or
 * one detection run), so there is no token refresh, and the client is never
 * signed out: a global sign-out would end the nightly job's session too.
 */
export async function signInBot(c: BotCredentials): Promise<SupabaseClient> {
  const supabase = createClient(c.supabaseUrl, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.auth.signInWithPassword({ email: c.email, password: c.password });
  if (error) throw new Error(`bot sign-in failed: ${error.message}`);
  return supabase;
}

/** The best shared hint for this recording and game, as the job's sync, or null when none matches. */
export async function lookupHint(supabase: SupabaseClient, fp: VideoFingerprint, match: GameVideoJobMatch, log: Logger): Promise<GameVideoJobSync | null> {
  const sourceGameId = match.sourceGameId ?? undefined;
  const candidates = await findVideoSyncHints(supabase, fp, sourceGameId);
  const best = pickBestHint(candidates, sourceGameId);
  if (!best) {
    log({ phase: "hints", candidates: candidates.length, hit: false });
    return null;
  }
  log({ phase: "hints", candidates: candidates.length, hit: true, method: best.hint.method, seconds: best.hint.tipoffVideoTime, confidence: best.hint.confidence, agreement: best.agreement });
  return syncFromHint(best.hint);
}

export interface DetectOptions {
  supabase: SupabaseClient;
  source: string;
  probe: Probe;
  fp: VideoFingerprint;
  match: GameVideoJobMatch;
  signal: AbortSignal;
  log: Logger;
  onProgress?: (fraction: number) => void;
}

/** Run the detector over the original and record a found tip-off as the bot's automatic hint. Throws on detector errors; the caller decides what that means. */
export async function detectTipoff(o: DetectOptions): Promise<GameVideoJobSync> {
  const deps = detectDeps(o.supabase, o.source, o.probe, (note) => o.log({ phase: "detect", note }));
  deps.signal = o.signal;
  deps.onProgress = (p) => o.onProgress?.(detectStageFraction(p));
  const result = await runTipoffDetection(o.probe.durationS, deps, { strategy: "crop" });
  const sync = syncFromDetection(result);
  o.log({
    phase: "detect",
    outcome: result.outcome,
    seconds: sync.seconds,
    confidence: sync.confidence,
    basis: result.outcome === "found" ? result.estimate.basis : undefined,
    view: result.outcome === "cancelled" ? undefined : result.view,
    calls: result.stats.apiCalls,
    frames: result.stats.frames,
    s: Math.round(result.stats.elapsedMs / 1000),
  });
  if (result.outcome === "found") {
    try {
      await saveVideoSyncHint(o.supabase, {
        fp: o.fp,
        sourceGameId: o.match.sourceGameId ?? undefined,
        tipoffVideoTime: result.estimate.seconds,
        method: "auto",
        confidence: result.estimate.confidence,
      });
    } catch (e) {
      o.log({ phase: "detect", hint: "not_saved", error: o.log.safe(e) });
    }
  }
  return sync;
}
