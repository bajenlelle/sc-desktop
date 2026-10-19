"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Pause, Play, StepBack, StepForward } from "lucide-react";
import { mediaFailureMessage, type MediaFailure } from "@scoutable/shared/lib/media-failure";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { VideoPlayer } from "@/components/video-player";
import { ClipScrubber } from "@/components/editor/clip-scrubber";
import { ControlButton, VolumeControl } from "@/components/editor/transport-bar";
import { togglePlayerMuted } from "@/lib/player-sound";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { probeVideo } from "@/lib/video-frames";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { fadeVariants, springs } from "@/lib/motion";
import { trackEvent } from "@/lib/analytics";

/** An external request to move the playhead (and optionally confirm); a new nonce re-applies the same second. */
export interface SeekRequest {
  seconds: number;
  nonce: number;
  confirm?: boolean;
}

export interface SyncPointPickerProps {
  videoPath: string;
  tipoffHint?: string;
  initialSeconds?: number;
  onConfirm: (seconds: number) => void;
  onSkip?: () => void;
  seekRequest?: SeekRequest | null;
  /** Rendered between the prompt and the video, e.g. the automatic tip-off suggestion. */
  suggestionSlot?: React.ReactNode;
  /** The user moved the playhead or set the tip-off themselves (not through `seekRequest`). */
  onUserAction?: (kind: "seek" | "confirm") => void;
  /** A suggestion is on offer above: its "Use" is the primary action, so this one steps back. */
  hasPendingSuggestion?: boolean;
}

/** m:ss.d; negative values (a recording that starts after the tip-off) keep their sign. */
export function formatMSSd(secs: number): string {
  const sign = secs < 0 ? "−" : "";
  const a = Math.abs(secs);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  const d = Math.floor((a % 1) * 10);
  return `${sign}${m}:${String(s).padStart(2, "0")}.${d}`;
}

/** A recording's whole length: h:mm:ss past the hour, m:ss under it. */
function formatLength(secs: number): string {
  const t = Math.floor(secs);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Used until the file's own rate is known (and for remote footage, which isn't probed). */
const FALLBACK_FRAME = 1 / 25;

/**
 * Finding the tip-off is precise work, so the footage and its controls are
 * one object and the controls never hide: a scrubber over the whole
 * recording, steps of ten seconds, a second and a single frame, and a large
 * readout. The keys belong to this picker while it is on screen (Space,
 * ←/→ a second, Shift ten, `,`/`.` a frame, J/K/L). The confirmed tip-off
 * stays visible after the playhead moves on, so what will be saved is never
 * a guess.
 */
export function SyncPointPicker({
  videoPath,
  initialSeconds,
  onConfirm,
  onSkip,
  seekRequest,
  suggestionSlot,
  onUserAction,
  hasPendingSuggestion = false,
}: SyncPointPickerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const [currentTime, setCurrentTime] = useState(initialSeconds ?? 0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [confirmedTime, setConfirmedTime] = useState<number | null>(initialSeconds ?? null);
  const [frameSeconds, setFrameSeconds] = useState(FALLBACK_FRAME);
  // Reported by VideoPlayer, which also shows the user why. Confirming on a
  // dead element would silently persist 0:00 over a possibly-correct sync
  // point — block it.
  const [loadFailure, setLoadFailure] = useState<MediaFailure | null>(null);
  const videoFailed = loadFailure !== null;
  const failureMessage = loadFailure ? mediaFailureMessage(loadFailure) : undefined;

  // The sample game's video is a remote R2 URL, not a local file.
  const src = isLocalPath(videoPath) ? streamFileSrc(videoPath) : videoPath;

  // Read from stable callbacks (seekBy, togglePlay, the key handler).
  const onUserActionRef = useRef(onUserAction);
  useEffect(() => {
    onUserActionRef.current = onUserAction;
  }, [onUserAction]);

  useEffect(() => {
    setVideoEl(videoRef.current);
  }, []);

  // A frame step is one frame of this file, not a guess.
  useEffect(() => {
    if (!isLocalPath(videoPath)) return;
    let cancelled = false;
    probeVideo(videoPath)
      .then((p) => {
        if (!cancelled && p.fps > 1 && p.fps < 241) setFrameSeconds(1 / p.fps);
      })
      .catch(() => {
        /* the fallback stands */
      });
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  // Media events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onLoadedMetadata() {
      if (!video) return;
      setDuration(video.duration);
      if (initialSeconds != null && initialSeconds > 0) {
        video.currentTime = initialSeconds;
        setCurrentTime(initialSeconds);
      }
    }
    function onTimeUpdate() {
      if (video && !video.seeking) setCurrentTime(video.currentTime);
    }
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    if (video.readyState >= 1) onLoadedMetadata();
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [initialSeconds]);

  // The readout follows playback at the display rate; at rest it shows the
  // state's time, which can be negative (a recording that starts after the
  // tip-off) while the element itself sits at 0.
  useEffect(() => {
    const el = readoutRef.current;
    const video = videoRef.current;
    if (!el) return;
    if (!playing || !video) {
      el.textContent = formatMSSd(currentTime);
      return;
    }
    let raf = 0;
    const tick = () => {
      el.textContent = formatMSSd(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, currentTime]);

  // External seeks (a shared hint or the detector's suggestion). The element
  // can't go below 0, but a negative confirmed time is a valid sync point for
  // a recording that starts after the tip-off, so the display keeps it.
  const seekNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!seekRequest || seekRequest.nonce === seekNonceRef.current) return;
    seekNonceRef.current = seekRequest.nonce;
    const video = videoRef.current;
    const target = Math.max(0, seekRequest.seconds);
    const apply = () => {
      if (video) video.currentTime = target;
      setCurrentTime(seekRequest.seconds);
      if (seekRequest.confirm) {
        setConfirmedTime(seekRequest.seconds);
        onConfirm(seekRequest.seconds);
      }
    };
    if (!video || video.readyState >= 1) {
      apply();
      return;
    }
    video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [seekRequest, onConfirm]);

  // play() rejects when the element has no playable source. VideoPlayer's
  // error listener already carries that signal; the rejection is a
  // stackless duplicate, so it's swallowed.
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    onUserActionRef.current?.("seek");
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = clamp(t, 0, video.duration || 0);
    video.currentTime = next;
    setCurrentTime(next);
    onUserActionRef.current?.("seek");
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      if (!video.paused && Math.abs(delta) < 1) video.pause(); // frame steps imply a still picture
      seekTo(video.currentTime + delta);
    },
    [seekTo],
  );

  function confirmHere() {
    const t = currentTime;
    setConfirmedTime(t);
    onConfirm(t);
    onUserActionRef.current?.("confirm");
  }

  useKeyScope("tipoff", true);
  useHotkeys("tipoff", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        return;
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
      case "m":
      case "M":
        if (e.shiftKey) return;
        togglePlayerMuted();
        return;
    }
  });

  const atConfirmed = confirmedTime !== null && Math.abs(currentTime - confirmedTime) < 0.05;
  const stepClass = "h-8 w-auto px-2 text-xs font-medium nums";

  return (
    <div>
      <div className="mb-3">
        <p className="text-headline text-foreground">Set the tip-off</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-callout text-muted-foreground">
          Find the frame where the ball goes up, then set it.
          <span className="inline-flex items-center gap-0.5">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </span>
          a second,
          <span className="inline-flex items-center gap-0.5">
            <Kbd>,</Kbd>
            <Kbd>.</Kbd>
          </span>
          a frame.
        </p>
      </div>

      {suggestionSlot}

      <div className="dark overflow-hidden rounded-lg bg-black text-white ring-1 ring-separator">
        {/* A click on the footage plays and pauses, like any player. */}
        <div onClick={togglePlay} className="[&>div]:rounded-none">
          <VideoPlayer src={src} videoRef={videoRef} onLoadFailure={setLoadFailure} />
        </div>
        <div className="flex flex-col gap-1 px-3 pt-1.5 pb-2">
          {videoEl && duration > 0 ? (
            <ClipScrubber
              video={videoEl}
              start={0}
              end={duration}
              onSeek={seekTo}
              frameSeconds={frameSeconds}
              showTimes={false}
              ariaLabel="Recording position"
            />
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
            <ControlButton label={playing ? "Pause" : "Play"} shortcut="Space" onClick={togglePlay} size="lg">
              {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
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
              {duration > 0 && <span className="text-xs text-white/50 nums">of {formatLength(duration)}</span>}
            </span>
            <VolumeControl />
          </div>
        </div>
      </div>

      {/* One row, one height: the states swap in place. */}
      <div className="mt-3 flex h-9 items-center gap-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {atConfirmed ? (
            <motion.span
              key="set"
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="status"
              className="flex h-9 items-center gap-2 rounded-md bg-emerald-500/12 px-3 text-sm font-medium text-emerald-700 dark:text-emerald-300"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={springs.settle}
                className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white"
              >
                <Check className="size-3" strokeWidth={3} />
              </motion.span>
              Tip-off set at <span className="nums">{formatMSSd(confirmedTime!)}</span>
            </motion.span>
          ) : (
            <motion.span key="unset" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="flex items-center gap-3">
              <Button
                variant={hasPendingSuggestion ? "outline" : "default"}
                disabled={videoFailed}
                title={failureMessage}
                onClick={confirmHere}
              >
                Set tip-off here
              </Button>
              {confirmedTime !== null && (
                <span className="text-callout text-muted-foreground">
                  Set at <span className="nums">{formatMSSd(confirmedTime)}</span>
                </span>
              )}
            </motion.span>
          )}
        </AnimatePresence>
        {onSkip && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              trackEvent("sync_point_skipped");
              onSkip();
            }}
          >
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
