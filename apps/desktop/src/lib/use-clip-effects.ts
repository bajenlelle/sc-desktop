/**
 * The playing clip's drawings and slow motion, applied to the video: when
 * playback reaches a drawing's frame the picture freezes there for the
 * drawing's hold (pause, seek back to the exact frame, wait, play), and
 * inside a slow section the rate is the viewer's speed times the section's.
 * A frame loop watches the playhead, since timeupdate comes about four times
 * a second in WKWebView. The rules are shared (clip-timeline.ts); this hook
 * only drives the element.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DrawingShape } from "@scoutable/shared/lib/clip-drawing";
import { drawingToShow, firedOnPlay, holdDue, rearm, slowRateAt, type SlowSpan } from "@scoutable/shared/lib/clip-timeline";

/** A drawing in the player's time base (`at`: seconds on the video's own clock). */
export interface EffectDrawing {
  id: string;
  at: number;
  hold: number;
  shapes: DrawingShape[];
}

export function useClipEffects(
  video: HTMLVideoElement | null,
  effects: { drawings: EffectDrawing[]; slows: SlowSpan[] },
  /** The viewer's chosen speed; slow sections multiply it. */
  speed: number,
  enabled: boolean,
): { holding: EffectDrawing | null; shown: EffectDrawing | null; cancel: () => void } {
  const [holding, setHolding] = useState<EffectDrawing | null>(null);
  const [shown, setShown] = useState<EffectDrawing | null>(null);
  const effectsRef = useRef(effects);
  const speedRef = useRef(speed);
  useLayoutEffect(() => {
    effectsRef.current = effects;
    speedRef.current = speed;
  });
  const firedRef = useRef<Set<string>>(new Set());
  const holdingRef = useRef<EffectDrawing | null>(null);
  const timerRef = useRef<number | null>(null);
  /** The next pause event is our own (a hold starting), not the viewer's. */
  const selfPauseRef = useRef(false);
  const shownRef = useRef<EffectDrawing | null>(null);

  const endHold = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (holdingRef.current) {
      holdingRef.current = null;
      setHolding(null);
    }
  }, []);

  // A new clip (or edited drawings): nothing has fired, nothing is held.
  const idsKey = effects.drawings.map((d) => `${d.id}@${d.at}`).join(",");
  useEffect(() => {
    firedRef.current = new Set();
    endHold();
  }, [idsKey, endHold]);

  // The viewer's own pause ends a hold where it stands; a play goes on from it.
  useEffect(() => {
    if (!video) return;
    const onPause = () => {
      if (selfPauseRef.current) {
        selfPauseRef.current = false;
        return;
      }
      endHold();
    };
    const onPlay = () => endHold();
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
    };
  }, [video, endHold]);

  useEffect(() => {
    if (!video || !enabled) return;
    const startHold = (d: EffectDrawing) => {
      firedRef.current.add(d.id);
      holdingRef.current = d;
      setHolding(d);
      selfPauseRef.current = true;
      video.pause();
      video.currentTime = d.at;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (holdingRef.current?.id !== d.id) return;
        holdingRef.current = null;
        setHolding(null);
        video.play().catch(() => {});
      }, d.hold * 1000);
    };
    let raf = 0;
    let wasPaused = video.paused;
    const tick = () => {
      const now = video.currentTime;
      const { drawings, slows } = effectsRef.current;
      if (firedRef.current.size > 0) firedRef.current = rearm(drawings, now, firedRef.current);
      // Play from a drawing's frame goes on (seen here, not in the play
      // event: a frame can run between play() and that event).
      if (wasPaused && !video.paused) firedRef.current = firedOnPlay(drawings, now, firedRef.current);
      wasPaused = video.paused;
      if (!holdingRef.current && !video.paused && !video.seeking) {
        const due = holdDue(drawings, now, firedRef.current);
        if (due) startHold(due);
      }
      const want = speedRef.current * slowRateAt(slows, now);
      if (Math.abs(video.playbackRate - want) > 1e-3) video.playbackRate = want;
      const next = drawingToShow(drawings, now, holdingRef.current?.id ?? null, video.paused);
      if (next?.id !== shownRef.current?.id || next?.shapes !== shownRef.current?.shapes) {
        shownRef.current = next;
        setShown(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      endHold();
      video.playbackRate = speedRef.current;
      shownRef.current = null;
      setShown(null);
    };
  }, [video, enabled, endHold]);

  return { holding, shown, cancel: endHold };
}
