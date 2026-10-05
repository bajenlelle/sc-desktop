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
import { DetectError, SILENT_DETECT_ERRORS, detectTipoff } from "@/lib/tipoff-detect";
import type { VideoProbe } from "@/lib/video-frames";
import type { SeekRequest } from "@/components/sync-point-picker";

export type TipoffSuggestionState =
  | { kind: "idle" }
  | { kind: "fingerprinting" }
  | { kind: "looking_up" }
  | { kind: "hint_found"; seconds: number; agreement: number; method: HintMethod }
  | { kind: "detecting"; stage: DetectProgress["stage"]; startedAt: number }
  | { kind: "suggested"; seconds: number; confidence: number; basis: string }
  | { kind: "starts_after_tipoff"; estimateS: number | null; firstClock: string | null }
  | { kind: "not_found" }
  | { kind: "failed"; error: string }
  | { kind: "rejected" }
  /** The user took the offer; the picker now shows the confirmed time. */
  | { kind: "accepted"; seconds: number }
  | { kind: "cancelled" }
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
  /** Call once the user has set or imported a sync point. */
  recordResolved: (confirmedSeconds: number) => void;
  /** Writes the user's own confirmed hint for this recording (no-op without a fingerprint). */
  saveConfirmed: (seconds: number) => Promise<void>;
}

const STAGE_TOTAL = 3;

export function useTipoffSuggestion(videoPath: string | null, sourceGameId?: string, opts: { autoDetect?: boolean } = {}): TipoffSuggestion {
  const autoDetect = opts.autoDetect ?? true;
  const [state, setState] = useState<TipoffSuggestionState>({ kind: "idle" });
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const fpRef = useRef<{ fp: VideoFingerprint; probe: VideoProbe } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nonceRef = useRef(0);
  const offeredRef = useRef<{ source: SuggestionSource; seconds: number | null }>({ source: "none", seconds: null });
  const resolvedRef = useRef(false);

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
    setSeekRequest(null);
    if (!videoPath) {
      setState({ kind: "idle" });
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    let active = true;
    const path = videoPath;

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
      fpRef.current = fingerprinted;

      setState({ kind: "looking_up" });
      try {
        const cands = await findVideoSyncHints(fingerprinted.fp, sourceGameId);
        if (!active) return;
        const best = pickBestHint(cands, sourceGameId);
        trackEvent("tipoff_hint_lookup", { hit: !!best, agreement: best?.agreement ?? 0, method: best?.hint.method ?? null, candidates: cands.length });
        if (best) {
          offeredRef.current = { source: "hint", seconds: best.hint.tipoffVideoTime };
          setState({ kind: "hint_found", seconds: best.hint.tipoffVideoTime, agreement: best.agreement, method: best.hint.method });
          seek(best.hint.tipoffVideoTime, false);
          return;
        }
      } catch (err) {
        if (!active) return;
        Sentry.captureException(err, { tags: { feature: "tipoff_detect", step: "lookup" } });
        // A failed lookup is not a reason to skip detection.
      }

      if (!autoDetect) {
        setState({ kind: "not_found" });
        return;
      }
      const startedAt = Date.now();
      setState({ kind: "detecting", stage: "locate", startedAt });
      trackEvent("tipoff_detect_started", { trigger: "auto", duration_s: Math.round(fingerprinted.probe.durationMs / 1000) });
      try {
        const result = await detectTipoff(path, fingerprinted.probe, {
          signal: ac.signal,
          onProgress: (p) => { if (active) setState({ kind: "detecting", stage: p.stage, startedAt }); },
        });
        if (!active) return;
        if (result.outcome === "cancelled") {
          trackEvent("tipoff_detect_cancelled", { elapsed_ms: result.stats.elapsedMs });
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
          setState({ kind: "suggested", seconds: result.estimate.seconds, confidence: result.estimate.confidence, basis: result.estimate.basis });
          seek(result.estimate.seconds, false);
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
        if (!active) return;
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
  }, [videoPath, sourceGameId, autoDetect, seek]);

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

  return { state, seekRequest, source: offeredRef.current.source, accept, reject, cancel, recordResolved, saveConfirmed };
}

export const DETECT_STAGE_TOTAL = STAGE_TOTAL;
