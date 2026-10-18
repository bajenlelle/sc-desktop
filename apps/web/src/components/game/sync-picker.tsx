"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Pause, Play, StepBack, StepForward } from "lucide-react";
import { formatMSSd } from "@scoutable/shared/lib/clip-timing";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { ClipScrubber } from "@/components/player/clip-scrubber";
import { ControlButton } from "@/components/player/transport-bar";
import { useMediaDuration, useMediaElement, useMediaPaused } from "@/components/player/use-media";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { fadeVariants, springs } from "@/lib/motion";

export type SyncAnchorKind = "tipoff" | "first_basket";

/** An external request to move the playhead (and optionally confirm); a new nonce re-applies the same second. */
export interface SeekRequest {
  seconds: number;
  nonce: number;
  confirm?: boolean;
}

interface AnchorCopy {
  title: string;
  instruction: string;
  button: string;
  confirmed: string;
}

const ANCHOR_COPY: Record<SyncAnchorKind, AnchorCopy> = {
  tipoff: {
    title: "Set the tip-off",
    instruction: "Find the frame where the ball goes up, then set it.",
    button: "Set tip-off here",
    confirmed: "Tip-off set at",
  },
  first_basket: {
    title: "Set the first basket",
    instruction: "Find the frame where the ball drops through the net on the first basket, then set it.",
    button: "Set first basket here",
    confirmed: "First basket set at",
  },
};

/** A recording's whole length: h:mm:ss past the hour, m:ss under it. */
function formatLength(secs: number): string {
  const t = Math.floor(secs);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Used until the copy's own rate is known. */
export const FALLBACK_FRAME_SECONDS = 1 / 25;

export interface SyncPickerProps {
  /** The copy's play URL; a later one comes through onSourceStale. */
  src: string;
  /** The play URL ran out or failed: asks for a fresh one; null when the game is gone. */
  onSourceStale: () => Promise<string | null>;
  /**
   * Which moment to find. Genius games anchor on the tip-off; Profixio games
   * on the first made basket, because the table's "Start period 1" is
   * pressed minutes before the jump ball.
   */
  anchorKind?: SyncAnchorKind;
  /** Where to look, in words: "Örebro's first basket (2–0), 16:30". */
  anchorDetail?: string;
  /** Where the playhead starts: the suggestion, or the time already set. */
  initialSeconds?: number | null;
  /** One frame of this copy, from the row's fps. */
  frameSeconds?: number;
  /** Rendered between the prompt and the video, e.g. the converter's suggestion. */
  suggestionSlot?: React.ReactNode;
  /** A suggestion is on offer above: its "Use" is the primary action, so this one steps back. */
  hasPendingSuggestion?: boolean;
  seekRequest?: SeekRequest | null;
  onConfirm: (seconds: number) => void | Promise<void>;
  /** The confirmation is being saved: the button waits. */
  confirming?: boolean;
  /** The moment already set, when the parent knows it; undefined = the picker keeps its own. */
  confirmedSeconds?: number | null;
  /** The user moved the playhead or set the moment themselves (not through `seekRequest`). */
  onUserAction?: (kind: "seek" | "confirm") => void;
  /**
   * The surface the picker's keys belong to, when it sits in a dialog:
   * without one, its keys yield to any open dialog, its own included.
   */
  keyContainer?: React.RefObject<HTMLElement | null>;
}

/**
 * Finding the tip-off is precise work, so the footage and its controls are
 * one object and the controls never hide: a scrubber over the whole
 * recording, steps of ten seconds, a second and a single frame, and a large
 * readout. The keys belong to this picker while it is on screen (Space,
 * ←/→ a second, Shift ten, `,`/`.` a frame, J/K/L). The confirmed moment
 * stays visible after the playhead moves on, so what will be saved is never
 * a guess. The web port of the desktop's sync-point-picker over the cloud
 * copy's play URL.
 */
export function SyncPicker({
  src,
  onSourceStale,
  anchorKind = "tipoff",
  anchorDetail,
  initialSeconds,
  frameSeconds = FALLBACK_FRAME_SECONDS,
  suggestionSlot,
  hasPendingSuggestion = false,
  seekRequest,
  onConfirm,
  confirming = false,
  confirmedSeconds,
  onUserAction,
  keyContainer,
}: SyncPickerProps) {
  const copy = ANCHOR_COPY[anchorKind];
  const { element: video, ref: videoRef, attach } = useMediaElement<HTMLVideoElement>();
  const duration = useMediaDuration(video);
  const paused = useMediaPaused(video);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const [currentTime, setCurrentTime] = useState(initialSeconds ?? 0);
  // The parent's confirmed time when it keeps one, else the picker's own.
  const [ownConfirmed, setConfirmedTime] = useState<number | null>(initialSeconds ?? null);
  const confirmedTime = confirmedSeconds !== undefined ? confirmedSeconds : ownConfirmed;
  const [failed, setFailed] = useState(false);

  const onUserActionRef = useRef(onUserAction);
  const onSourceStaleRef = useRef(onSourceStale);
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onUserActionRef.current = onUserAction;
    onSourceStaleRef.current = onSourceStale;
    onConfirmRef.current = onConfirm;
  });

  // Media events: the playhead's position at rest, the start position once
  // the metadata is in, and a fresh URL when the current one has run out
  // (they live 12 hours), carrying on from the same second.
  // The element is subscribed to as state and changed through the ref, as
  // the watch view does.
  const refreshingRef = useRef(false);
  useEffect(() => {
    if (!video) return;
    const onLoadedMetadata = () => {
      const el = videoRef.current;
      if (!el) return;
      if (initialSeconds != null && initialSeconds > 0 && Math.abs(el.currentTime - initialSeconds) > 0.05) {
        el.currentTime = initialSeconds;
        setCurrentTime(initialSeconds);
      }
    };
    const onTimeUpdate = () => {
      const el = videoRef.current;
      if (el && !el.seeking) setCurrentTime(el.currentTime);
    };
    const onError = async () => {
      const el = videoRef.current;
      if (!el || refreshingRef.current) return;
      refreshingRef.current = true;
      const at = el.currentTime;
      const fresh = await onSourceStaleRef.current();
      if (fresh) {
        el.src = fresh;
        el.currentTime = at;
      } else {
        setFailed(true);
      }
      window.setTimeout(() => {
        refreshingRef.current = false;
      }, 30_000);
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("error", onError);
    if (video.readyState >= 1) onLoadedMetadata();
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("error", onError);
    };
  }, [video, videoRef, initialSeconds]);

  // The readout follows playback at the display rate; at rest it shows the
  // state's time.
  useEffect(() => {
    const el = readoutRef.current;
    if (!el) return;
    if (paused || !video) {
      el.textContent = formatMSSd(currentTime);
      return;
    }
    let raf = 0;
    const tick = () => {
      el.textContent = formatMSSd(videoRef.current?.currentTime ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, currentTime, video, videoRef]);

  // External seeks (the converter's suggestion). A request counts as handled
  // only once applied: one made before the video has loaded waits for its
  // metadata.
  const seekNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!seekRequest || seekRequest.nonce === seekNonceRef.current) return;
    const el = videoRef.current;
    const target = Math.max(0, seekRequest.seconds);
    const apply = () => {
      seekNonceRef.current = seekRequest.nonce;
      if (el) el.currentTime = target;
      setCurrentTime(seekRequest.seconds);
      if (seekRequest.confirm) {
        setConfirmedTime(seekRequest.seconds);
        void onConfirmRef.current(seekRequest.seconds);
      }
    };
    if (!el || el.readyState >= 1) {
      apply();
      return;
    }
    el.addEventListener("loadedmetadata", apply, { once: true });
    return () => el.removeEventListener("loadedmetadata", apply);
  }, [seekRequest, videoRef]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    onUserActionRef.current?.("seek");
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, [videoRef]);

  const seekTo = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el) return;
      const next = clamp(t, 0, el.duration || 0);
      el.currentTime = next;
      setCurrentTime(next);
      onUserActionRef.current?.("seek");
    },
    [videoRef],
  );

  const seekBy = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el) return;
      if (!el.paused && Math.abs(delta) < 1) el.pause(); // frame steps imply a still picture
      seekTo(el.currentTime + delta);
    },
    [seekTo, videoRef],
  );

  function confirmHere() {
    const t = currentTime;
    setConfirmedTime(t);
    onUserActionRef.current?.("confirm");
    void onConfirm(t);
  }

  useKeyScope("tipoff", true, keyContainer);
  useHotkeys("tipoff", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case " ": {
        e.preventDefault();
        // Space is play/pause here. A focused button would also press
        // itself when the key comes up, so it lets go of the focus first.
        const button = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("button, [role='button']") : null;
        button?.blur();
        togglePlay();
        return;
      }
      case "ArrowLeft":
        e.preventDefault();
        seekBy(e.shiftKey ? -10 : -1);
        return;
      case "ArrowRight":
        e.preventDefault();
        seekBy(e.shiftKey ? 10 : 1);
        return;
      case ",":
        e.preventDefault();
        seekBy(-frameSeconds);
        return;
      case ".":
        e.preventDefault();
        seekBy(frameSeconds);
        return;
      case "j":
        seekBy(-1);
        return;
      case "k":
        videoRef.current?.pause();
        return;
      case "l":
        seekBy(1);
        return;
    }
  });

  const atConfirmed = confirmedTime !== null && Math.abs(currentTime - confirmedTime) < 0.05;
  const stepClass = "h-8 w-auto px-2 text-xs font-medium nums";

  return (
    <div>
      <div className="mb-3">
        <p className="text-headline text-foreground">{copy.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-callout text-muted-foreground">
          {copy.instruction}
          <span className="hidden items-center gap-0.5 pointer-fine:inline-flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </span>
          <span className="hidden pointer-fine:inline">a second,</span>
          <span className="hidden items-center gap-0.5 pointer-fine:inline-flex">
            <Kbd>,</Kbd>
            <Kbd>.</Kbd>
          </span>
          <span className="hidden pointer-fine:inline">a frame.</span>
          {anchorDetail && <> Look for {anchorDetail}.</>}
        </p>
        {anchorKind === "first_basket" && (
          <p className="mt-1 text-callout text-muted-foreground">
            Profixio&apos;s table marks the start of play a few minutes before the jump ball, so the first basket is the reliable
            reference.
          </p>
        )}
      </div>

      {suggestionSlot}

      <div className="dark overflow-hidden rounded-lg bg-black text-white ring-1 ring-separator">
        {/* A click on the footage plays and pauses, like any player. */}
        <video ref={attach} src={src} playsInline preload="metadata" onClick={togglePlay} className="aspect-video w-full bg-black" />
        <div className="flex flex-col gap-1 px-3 pt-1.5 pb-2">
          {video && duration ? (
            <ClipScrubber video={video} duration={duration} start={0} onSeek={seekTo} frameSeconds={frameSeconds} />
          ) : (
            <div className="h-6" />
          )}
          <div className="flex items-center gap-0.5">
            <ControlButton label="Back 10 seconds" shortcut="⇧←" onClick={() => seekBy(-10)} className={stepClass}>
              −10s
            </ControlButton>
            <ControlButton label="Back 1 second" shortcut="←" onClick={() => seekBy(-1)} className={stepClass}>
              −1s
            </ControlButton>
            <ControlButton label="Previous frame" shortcut="," onClick={() => seekBy(-frameSeconds)}>
              <StepBack />
            </ControlButton>
            <ControlButton label={paused ? "Play" : "Pause"} shortcut="Space" onClick={togglePlay} size="lg">
              {paused ? <Play className="translate-x-px fill-current" /> : <Pause className="fill-current" />}
            </ControlButton>
            <ControlButton label="Next frame" shortcut="." onClick={() => seekBy(frameSeconds)}>
              <StepForward />
            </ControlButton>
            <ControlButton label="Forward 1 second" shortcut="→" onClick={() => seekBy(1)} className={stepClass}>
              +1s
            </ControlButton>
            <ControlButton label="Forward 10 seconds" shortcut="⇧→" onClick={() => seekBy(10)} className={stepClass}>
              +10s
            </ControlButton>
            <span className="ml-auto flex items-baseline gap-1.5 pl-3">
              <span ref={readoutRef} className="text-xl font-medium tracking-tight text-white nums" />
              {duration ? <span className="text-xs text-white/50 nums">of {formatLength(duration)}</span> : null}
            </span>
          </div>
        </div>
      </div>

      {/* One row, one height: the states swap in place. */}
      <div className="mt-3 flex h-9 items-center gap-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {atConfirmed && !confirming ? (
            <motion.span
              key="set"
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="status"
              className="flex h-9 items-center gap-2 rounded-md bg-success/12 px-3 text-sm font-medium text-success"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={springs.settle}
                className="flex size-4 items-center justify-center rounded-full bg-success text-success-foreground"
              >
                <Check className="size-3" strokeWidth={3} />
              </motion.span>
              {copy.confirmed} <span className="nums">{formatMSSd(confirmedTime!)}</span>
            </motion.span>
          ) : (
            <motion.span key="unset" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="flex items-center gap-3">
              <Button
                variant={hasPendingSuggestion ? "outline" : "default"}
                disabled={failed || confirming}
                title={failed ? "The video couldn't be loaded" : undefined}
                onClick={confirmHere}
              >
                {confirming && <Loader2 className="animate-spin" />}
                {copy.button}
              </Button>
              {confirmedTime !== null && !confirming && (
                <span className="text-callout text-muted-foreground">
                  Set at <span className="nums">{formatMSSd(confirmedTime)}</span>
                </span>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
