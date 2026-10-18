/**
 * How the converter decides what to say about the tip-off: skip for games
 * that don't anchor on a known tip-off time, take a shared hint when one
 * matches the recording, otherwise what the detector concluded. Pure; the
 * database side of the rule is `_game_video_finish_convert`
 * (lib/game-video-convert.ts syncStatusFor mirrors it).
 */
import type { DetectProgress, DetectResult } from "@scoutable/shared/lib/tipoff-detect";
import type { GameVideoJobMatch, GameVideoJobSync } from "@scoutable/shared/lib/game-video-wire";
import type { VideoSyncHintCandidate } from "@scoutable/shared/lib/video-sync-hints-db";

/** A recording that starts after the tip-off gives a (negative) estimate the detector can't check: a suggestion only. */
export const STARTS_AFTER_TIPOFF_CONFIDENCE = 0.5;

export type SyncSkipReason = "profixio" | "no_anchor_time";

/**
 * Hints and detection find the Q1 tip-off; a Profixio game anchors on its
 * first basket and a game whose feed gave no anchor time has nothing to line
 * the tip-off up with, so both are reported as skipped.
 */
export function syncSkipReason(match: Pick<GameVideoJobMatch, "isProfixio" | "anchorRealWorldTime">): SyncSkipReason | null {
  if (match.isProfixio) return "profixio";
  if (!match.anchorRealWorldTime) return "no_anchor_time";
  return null;
}

/** A confirmed hint is taken as is; an automatic one is an estimate with the confidence it was found with. */
export function syncFromHint(hint: Pick<VideoSyncHintCandidate, "method" | "tipoffVideoTime" | "confidence">): GameVideoJobSync {
  if (hint.method === "confirmed") return { outcome: "confirmed", seconds: hint.tipoffVideoTime };
  return hint.confidence === null
    ? { outcome: "estimate", seconds: hint.tipoffVideoTime }
    : { outcome: "estimate", seconds: hint.tipoffVideoTime, confidence: hint.confidence };
}

export function syncFromDetection(result: DetectResult): GameVideoJobSync {
  switch (result.outcome) {
    case "found":
      return { outcome: "estimate", seconds: result.estimate.seconds, confidence: result.estimate.confidence };
    case "starts_after_tipoff":
      return result.estimateS !== null && Number.isFinite(result.estimateS)
        ? { outcome: "estimate", seconds: result.estimateS, confidence: STARTS_AFTER_TIPOFF_CONFIDENCE }
        : { outcome: "not_found" };
    default:
      return { outcome: "not_found" };
  }
}

/** Where the detector's stages sit on its share of the progress bar (the detector reports stage starts, not counts). */
export function detectStageFraction(p: DetectProgress): number {
  switch (p.stage) {
    case "locate":
      return 0.05;
    case "coarse":
      return 0.2;
    case "narrow":
      return 0.5;
    case "fine":
      return 0.7;
  }
}
