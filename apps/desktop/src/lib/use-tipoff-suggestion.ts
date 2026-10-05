/**
 * The automatic tip-off suggestion for a linked video: fingerprint the
 * recording, look up a sync hint other users left for it, otherwise run the
 * detector (frames of the first minutes are sent to the detection service),
 * and offer the result. The suggestion never applies itself: accepting it
 * drives the picker through a confirmed seek, and importing or confirming
 * writes the user's own `confirmed` hint for the next person.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectProgress } from "@scoutable/shared/lib/tipoff-detect";
import type { VideoFingerprint } from "@scoutable/shared/lib/video-fingerprint";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { computeVideoFingerprint } from "@/lib/video-fingerprint";
import { findVideoSyncHints, pickBestHint, saveVideoSyncHint, type HintMethod } from "@/lib/video-sync-hints-db";
import { HINT_AGREEMENT_S } from "@scoutable/shared/lib/video-sync-hints-db";
import { DetectError, SILENT_DETECT_ERRORS, detectTipoff } from "@/lib/tipoff-detect";
import type { VideoProbe } from "@/lib/video-frames";
import type { SeekRequest } from "@/components/sync-point-picker";

export type TipoffSuggestionState =
  | { kind: "idle" }
  | { kind: "fingerprinting" }
  | { kind: "looking_up" }
  | { kind: "hint_found"; seconds: number; agreement: number; method: HintMethod }
  | { kind: "detecting"; stage: DetectProgress["stage"]; startedAt: number }
  /** `previewed`: the picker was moved to the suggestion (only when the user hadn't touched it). */
  | { kind: "suggested"; seconds: number; confidence: number; basis: string; previewed: boolean }
  | { kind: "starts_after_tipoff"; estimateS: number | null; firstClock: string | null }
  | { kind: "not_found" }
  | { kind: "failed"; error: string }
  | { kind: "rejected" }
  /** The user took the offer; the picker now shows the confirmed time. */
  | { kind: "accepted"; seconds: number }
  | { kind: "cancelled" }
  /** The user set the tip-off in the picker before the suggestion arrived. */
  | { kind: "manual" }
  /** Kill switch, rate limit or no fingerprint: nothing to show (the reason is surfaced in dev builds). */
  | { kind: "unavailable"; reason: string };

export type SuggestionSource = "hint" | "auto" | "none";

export interface TipoffSuggestion {
  state: TipoffSuggestionState;
  seekRequest: SeekRequest | null;
  /** What was offered, for the import analytics. */
  source: SuggestionSource;
  /** Seek the picker to the suggestion and confirm it there. */
  accept: () => void;
  reject: () => void;
  cancel: () => void;
  /**
   * Wire to the picker's `onUserAction`. After a user seek, results no longer move the
   * playhead; after a user confirm, the search stops and the strip goes away.
   */
  noteUserAction: (kind: "seek" | "confirm") => void;
  /** Call once the user has set or imported a sync point. */
  recordResolved: (confirmedSeconds: number) => void;
  /** Writes the user's own confirmed hint for this recording (no-op without a fingerprint). */
  saveConfirmed: (seconds: number) => Promise<void>;
}

const STAGE_TOTAL = 3;

export function useTipoffSuggestion(
  videoPath: string | null,
  sourceGameId?: string,
  /**
   * Read once when a video is linked. `autoDetect: false` (the game already has a sync
   * point) only looks up hints; `existingSeconds` hides a hint that agrees with it.
   */
  opts: { autoDetect?: boolean; existingSeconds?: number } = {},
): TipoffSuggestion {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const [state, setState] = useState<TipoffSuggestionState>({ kind: "idle" });
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const fpRef = useRef<{ fp: VideoFingerprint; probe: VideoProbe } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nonceRef = useRef(0);
  const offeredRef = useRef<{ source: SuggestionSource; seconds: number | null }>({ source: "none", seconds: null });
  const resolvedRef = useRef(false);
  // What the user has done in the picker since this video was linked. An existing sync
  // point (autoDetect off) counts as positioned: a hint must not move it.
  const userRef = useRef<"none" | "seeked" | "confirmed">("none");

  const seek = useCallback((seconds: number, confirm: boolean) => {
    nonceRef.current += 1;
    setSeekRequest({ seconds, nonce: nonceRef.current, confirm });
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    fpRef.current = null;
    offeredRef.current = { source: "none", seconds: null };
    resolvedRef.current = false;
    const autoDetect = optsRef.current.autoDetect ?? true;
    const existingSeconds = optsRef.current.existingSeconds;
    userRef.current = autoDetect ? "none" : "seeked";
    setSeekRequest(null);
    if (!videoPath) {
      setState({ kind: "idle" });
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    let active = true;
    const path = videoPath;
    // The user set the tip-off themselves: show nothing more (noteUserAction already did).
    const decided = () => userRef.current === "confirmed";

    (async () => {
      setState({ kind: "fingerprinting" });
      let fingerprinted: { fp: VideoFingerprint; probe: VideoProbe };
      try {
        const r = await computeVideoFingerprint(path);
        fingerprinted = { fp: r.fingerprint, probe: r.probe };
      } catch (err) {
        if (!active) return;
        Sentry.captureException(err, { tags: { feature: "tipoff_detect", step: "fingerprint" } });
        console.warn("[tipoff] fingerprint failed:", err);
        setState({ kind: "unavailable", reason: `fingerprint: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      if (!active) return;
      // Kept even when the user has decided: saveConfirmed needs it to share their tip-off.
      fpRef.current = fingerprinted;
      if (decided()) return;

      setState({ kind: "looking_up" });
      try {
        const cands = await findVideoSyncHints(fingerprinted.fp, sourceGameId);
        if (!active || decided()) return;
        const best = pickBestHint(cands, sourceGameId);
        trackEvent("tipoff_hint_lookup", { hit: !!best, agreement: best?.agreement ?? 0, method: best?.hint.method ?? null, candidates: cands.length });
        if (best && existingSeconds != null && Math.abs(best.hint.tipoffVideoTime - existingSeconds) <= HINT_AGREEMENT_S) {
          // Nothing new: the game's sync point already agrees with what others found.
          setState({ kind: "idle" });
          return;
        }
        if (best) {
          offeredRef.current = { source: "hint", seconds: best.hint.tipoffVideoTime };
          setState({ kind: "hint_found", seconds: best.hint.tipoffVideoTime, agreement: best.agreement, method: best.hint.method });
          if (userRef.current === "none") seek(best.hint.tipoffVideoTime, false);
          return;
        }
      } catch (err) {
        if (!active) return;
        Sentry.captureException(err, { tags: { feature: "tipoff_detect", step: "lookup" } });
        // A failed lookup is not a reason to skip detection.
      }

      if (!autoDetect) {
        // Lookup only (the game already has a sync point): a miss is not news.
        setState({ kind: "idle" });
        return;
      }
      if (decided()) return;
      const startedAt = Date.now();
      setState({ kind: "detecting", stage: "locate", startedAt });
      trackEvent("tipoff_detect_started", { trigger: "auto", duration_s: Math.round(fingerprinted.probe.durationMs / 1000) });
      try {
        const result = await detectTipoff(path, fingerprinted.probe, {
          signal: ac.signal,
          onProgress: (p) => { if (active) setState({ kind: "detecting", stage: p.stage, startedAt }); },
        });
        // A manual confirm aborted the search and was tracked there.
        if (!active || decided()) return;
        if (result.outcome === "cancelled") {
          trackEvent("tipoff_detect_cancelled", { elapsed_ms: result.stats.elapsedMs, reason: "cancel_button" });
          setState({ kind: "cancelled" });
          return;
        }
        trackEvent("tipoff_detect_completed", {
          outcome: result.outcome,
          basis: result.outcome === "found" ? result.estimate.basis : null,
          confidence: result.outcome === "found" ? result.estimate.confidence : null,
          seconds: result.outcome === "found" ? result.estimate.seconds : result.outcome === "starts_after_tipoff" ? result.estimateS : null,
          elapsed_ms: result.stats.elapsedMs,
          api_calls: result.stats.apiCalls,
          frames: result.stats.frames,
          view: result.view,
        });
        if (result.outcome === "found") {
          offeredRef.current = { source: "auto", seconds: result.estimate.seconds };
          const previewed = userRef.current === "none";
          setState({ kind: "suggested", seconds: result.estimate.seconds, confidence: result.estimate.confidence, basis: result.estimate.basis, previewed });
          if (previewed) seek(result.estimate.seconds, false);
          saveVideoSyncHint({ fp: fingerprinted.fp, sourceGameId, tipoffVideoTime: result.estimate.seconds, method: "auto", confidence: result.estimate.confidence })
            .then(() => trackEvent("tipoff_hint_saved", { method: "auto" }))
            .catch((err) => Sentry.captureException(err, { tags: { feature: "tipoff_detect", step: "save_auto" } }));
        } else if (result.outcome === "starts_after_tipoff") {
          offeredRef.current = { source: "auto", seconds: result.estimateS };
          setState({ kind: "starts_after_tipoff", estimateS: result.estimateS, firstClock: result.firstClock });
        } else {
          setState({ kind: "not_found" });
        }
      } catch (err) {
        if (!active || decided()) return;
        const token = err instanceof DetectError ? err.token : String(err instanceof Error ? err.message : err).slice(0, 120);
        if (err instanceof DetectError && SILENT_DETECT_ERRORS.has(err.token)) {
          setState({ kind: "unavailable", reason: err.token });
          return;
        }
        trackEvent("tipoff_detect_failed", { error: token });
        Sentry.captureException(err, { tags: { feature: "tipoff_detect", step: "detect" } });
        setState({ kind: "failed", error: token });
      }
    })();

    return () => {
      active = false;
      ac.abort();
    };
  }, [videoPath, sourceGameId, seek]);

  const accept = useCallback(() => {
    const s = state;
    let seconds: number | null = null;
    if (s.kind === "hint_found") {
      trackEvent("tipoff_hint_used", { method: s.method, agreement: s.agreement });
      seconds = s.seconds;
    } else if (s.kind === "suggested") {
      seconds = s.seconds;
    } else if (s.kind === "starts_after_tipoff" && s.estimateS != null) {
      seconds = s.estimateS;
    }
    if (seconds == null) return;
    seek(seconds, true);
    setState({ kind: "accepted", seconds });
  }, [state, seek]);

  const reject = useCallback(() => {
    if (state.kind === "hint_found") trackEvent("tipoff_hint_rejected", { method: state.method });
    setState({ kind: "rejected" });
  }, [state]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => (s.kind === "detecting" ? { kind: "cancelled" } : s));
  }, []);

  const noteUserAction = useCallback((kind: "seek" | "confirm") => {
    if (kind === "seek") {
      if (userRef.current === "none") userRef.current = "seeked";
      return;
    }
    userRef.current = "confirmed";
    if (state.kind === "detecting") {
      abortRef.current?.abort();
      trackEvent("tipoff_detect_cancelled", { elapsed_ms: Date.now() - state.startedAt, reason: "set_manually" });
    }
    if (state.kind !== "idle" && state.kind !== "unavailable") setState({ kind: "manual" });
  }, [state]);

  const recordResolved = useCallback((confirmedSeconds: number) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    const offered = offeredRef.current;
    trackEvent("tipoff_suggestion_resolved", {
      source: offered.source,
      suggested_seconds: offered.seconds,
      confirmed_seconds: confirmedSeconds,
      delta_seconds: offered.seconds == null ? null : Number((confirmedSeconds - offered.seconds).toFixed(2)),
    });
  }, []);

  const saveConfirmed = useCallback(async (seconds: number) => {
    const fp = fpRef.current;
    if (!fp) return;
    try {
      await saveVideoSyncHint({ fp: fp.fp, sourceGameId, tipoffVideoTime: seconds, method: "confirmed" });
      trackEvent("tipoff_hint_saved", { method: "confirmed" });
    } catch (err) {
      Sentry.captureException(err, { tags: { feature: "tipoff_detect", step: "save_confirmed" } });
    }
  }, [sourceGameId]);

  return { state, seekRequest, source: offeredRef.current.source, accept, reject, cancel, noteUserAction, recordResolved, saveConfirmed };
}

export const DETECT_STAGE_TOTAL = STAGE_TOTAL;
