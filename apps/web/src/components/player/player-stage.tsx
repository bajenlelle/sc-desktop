"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { classifyMediaError, type MediaFailure } from "@scoutable/shared/lib/media-failure";
import { Button } from "@/components/ui/button";
import { PortalContainerProvider } from "@/lib/portal-container";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ClipScrubber } from "./clip-scrubber";
import {
  ControlButton,
  FullscreenButton,
  PlayPauseGlyph,
  SpeedMenu,
  TransportBar,
  type TransportProps,
} from "./transport-bar";
import { useMediaPaused } from "./use-media";

const IDLE_MS = 2500;
/** Narrower than this, the controls take the phone layout. */
const COMPACT_WIDTH = 560;

/** What a recipient is told when a clip can't be shown: they can't fix the file, only retry. */
function failureMessage(kind: MediaFailure): string {
  return kind === "unavailable"
    ? "Can't load this clip. Check your connection and try again."
    : "This clip can't be played in this browser.";
}

/** Whether an element is narrower than `width`, kept current as it resizes. */
function useNarrowerThan(el: HTMLElement | null, width: number): boolean {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!el) return () => {};
      const observer = new ResizeObserver(notify);
      observer.observe(el);
      return () => observer.disconnect();
    },
    [el],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => (el ? el.clientWidth < width : false),
    () => false,
  );
}

/** What a page can ask of the stage: Space toggles through here, so the key gets the same glyph as a click. */
export interface PlayerStageHandle {
  togglePlay: () => void;
}

export interface PlayerStageProps {
  /** The stage's <video>: attached here, followed through `video`, changed through `videoRef`. */
  attachVideo: (el: HTMLVideoElement | null) => void;
  video: HTMLVideoElement | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** What the page has loaded (it sets the element's source itself); null until then. */
  src: string | null;
  /** The playing clip's length; no scrubber without one. */
  duration: number | null;
  onSeek: (t: number) => void;
  transport: Omit<TransportProps, "paused" | "onTogglePlay"> & { onPlayAll?: () => void };
  speed: number;
  onSpeedChange: (speed: number) => void;
  fullscreen: { active: boolean; layer: boolean; toggle: () => void; exit: () => void };
  /** The stage element, for full screen and for menus while in it. */
  stageRef: (el: HTMLDivElement | null) => void;
  stage: HTMLDivElement | null;
  /** Full-screen top bar. */
  title?: string;
  position?: { index: number; total: number } | null;
  /** Something other than the footage is playing (a timed text card): its state drives the controls. */
  playback?: { paused: boolean; toggle: () => void };
  /** Overlays on the footage (a text card, the Play button). */
  children?: React.ReactNode;
  className?: string;
  handleRef?: React.Ref<PlayerStageHandle>;
}

/**
 * The footage with its controls floating over it, QuickTime-style: a
 * translucent bar that shows while paused or when the pointer moves and
 * hides after a moment of stillness during playback; a click on the
 * footage toggles playback with a brief glyph; a spinner while the decoder
 * is behind; what went wrong when nothing can play.
 *
 * Narrower than a tablet, it is iOS's inline player instead: a tap shows or
 * hides the controls (it never pauses), previous, play and next sit large in
 * the middle, and the timeline runs along the bottom.
 */
export function PlayerStage({
  attachVideo,
  video,
  videoRef,
  src,
  duration,
  onSeek,
  transport,
  speed,
  onSpeedChange,
  fullscreen,
  stageRef,
  stage,
  title,
  position,
  playback,
  children,
  className,
  handleRef,
}: PlayerStageProps) {
  const paused = useMediaPaused(video);
  const compact = useNarrowerThan(stage, COMPACT_WIDTH);
  const reduced = useReducedMotionSafe();
  const [buffering, setBuffering] = React.useState(false);
  const [failure, setFailure] = React.useState<MediaFailure | null>(null);
  const [flash, setFlash] = React.useState<{ id: number; kind: "play" | "pause" } | null>(null);
  const [awake, setAwake] = React.useState(true);
  const [activity, setActivity] = React.useState(0);
  const [chromeHover, setChromeHover] = React.useState(false);
  const lastPointer = React.useRef<string | null>(null);

  const effectivePaused = playback ? playback.paused : paused;

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // The default carries the rate across the next clip's load.
    el.defaultPlaybackRate = speed;
    el.playbackRate = speed;
  }, [video, videoRef, src, speed]);

  // When the player goes, give back the element's decoder and buffers: a
  // detached <video> that keeps its source stays alive, and enough of them
  // push WebKit into purging every paused video. (StrictMode re-runs this
  // on a live element, which must keep playing.)
  React.useEffect(() => {
    if (!video) return;
    return () => {
      if (video.isConnected) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [video]);

  // Why the box is black, when it is.
  React.useEffect(() => {
    if (!video) return;
    let bufferTimer: number | null = null;
    const armBuffering = () => {
      if (bufferTimer !== null) return;
      bufferTimer = window.setTimeout(() => {
        bufferTimer = null;
        setBuffering(true);
      }, 250);
    };
    const clearBuffering = () => {
      if (bufferTimer !== null) window.clearTimeout(bufferTimer);
      bufferTimer = null;
      setBuffering(false);
    };
    const onError = () => {
      clearBuffering();
      // An emptied element (no source) is not a failure.
      if (!video.getAttribute("src")) return;
      setFailure(classifyMediaError(video.error?.code));
    };
    // Audio decodes but the picture doesn't: no error event, just no frame.
    const onLoadedMetadata = () => {
      if (video.videoWidth === 0) setFailure("no_picture");
    };
    const onLoadStart = () => {
      setFailure(null);
      armBuffering();
    };
    const waiting = ["waiting", "stalled", "seeking"] as const;
    const ready = ["playing", "canplay", "seeked"] as const;
    for (const e of waiting) video.addEventListener(e, armBuffering);
    for (const e of ready) video.addEventListener(e, clearBuffering);
    video.addEventListener("error", onError);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadstart", onLoadStart);
    return () => {
      clearBuffering();
      for (const e of waiting) video.removeEventListener(e, armBuffering);
      for (const e of ready) video.removeEventListener(e, clearBuffering);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadstart", onLoadStart);
    };
  }, [video]);

  // The controls hide after a moment of stillness while playing; any
  // movement (or a tap) wakes them and restarts the count.
  React.useEffect(() => {
    if (effectivePaused || chromeHover || !awake) return;
    const timer = window.setTimeout(() => setAwake(false), IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [effectivePaused, chromeHover, awake, activity]);

  const wake = () => {
    setAwake(true);
    setActivity((n) => n + 1);
  };

  const chromeVisible = effectivePaused || awake || chromeHover;

  const togglePlay = React.useCallback(() => {
    if (playback) {
      setFlash({ id: Date.now(), kind: playback.paused ? "play" : "pause" });
      playback.toggle();
      return;
    }
    if (!video) return;
    if (!transport.isQueueActive && video.paused && transport.onPlayAll) {
      transport.onPlayAll();
      setFlash({ id: Date.now(), kind: "play" });
      return;
    }
    if (video.paused) {
      video.play().catch(() => {});
      setFlash({ id: Date.now(), kind: "play" });
    } else {
      video.pause();
      setFlash({ id: Date.now(), kind: "pause" });
    }
  }, [video, transport, playback]);

  React.useImperativeHandle(handleRef, () => ({ togglePlay }), [togglePlay]);

  const transportProps: TransportProps = { ...transport, paused: effectivePaused, onTogglePlay: togglePlay };
  const readout = position && position.total > 0 ? `${position.index + 1} of ${position.total}` : undefined;
  const scrubber =
    video && duration !== null && !playback ? <ClipScrubber video={video} duration={duration} onSeek={onSeek} /> : null;

  const stopBubbling = {
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setChromeHover(true);
    },
    onPointerLeave: () => setChromeHover(false),
  };

  return (
    <div
      ref={stageRef}
      data-fullscreen={fullscreen.active || undefined}
      className={cn(
        "@container/stage group/stage relative overflow-hidden bg-black select-none",
        fullscreen.layer
          ? "fixed inset-0 z-[60] h-dvh w-full"
          : fullscreen.active
            ? "h-full w-full"
            : "aspect-video w-full",
        fullscreen.active && !chromeVisible && "cursor-none",
        className,
      )}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") wake();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && !effectivePaused) setAwake(false);
      }}
      onClick={(e) => {
        const by = lastPointer.current;
        lastPointer.current = null;
        // A finger shows or hides the controls; it never pauses by accident.
        if (by && by !== "mouse") {
          if (chromeVisible && !effectivePaused) setAwake(false);
          else wake();
          return;
        }
        // The second click of a double-click is the full-screen gesture.
        if (e.detail > 1) return;
        togglePlay();
      }}
      onDoubleClick={(e) => {
        if (lastPointer.current && lastPointer.current !== "mouse") return;
        e.preventDefault();
        fullscreen.toggle();
      }}
    >
      <PortalContainerProvider container={fullscreen.active ? stage : null}>
        {/* No src prop: the queue sets the source and plays it in one go,
            inside the tap that asked for it. */}
        <video
          ref={attachVideo}
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-contain"
        />

        {children}

        {failure && (
          <div
            role="alert"
            className="absolute inset-0 z-[13] flex items-center justify-center bg-black/80 p-6 text-center text-sm text-white"
          >
            <p className="max-w-sm">{failureMessage(failure)}</p>
          </div>
        )}

        {buffering && !failure && (
          <div className="pointer-events-none absolute inset-0 z-[14] flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-white/80 drop-shadow" />
          </div>
        )}

        {/* The press, acknowledged on the footage itself (wide only: the
            narrow layout's centre button already shows it). */}
        <AnimatePresence>
          {flash && !compact && (
            <motion.div
              key={flash.id}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
              animate={{ opacity: 1, scale: reduced ? 1 : 1.1 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 1.2 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              onAnimationComplete={() => setFlash((f) => (f?.id === flash.id ? null : f))}
              className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center"
            >
              <div className="flex size-16 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm [&_svg]:size-7">
                {flash.kind === "play" ? <Play className="translate-x-0.5 fill-current" /> : <Pause className="fill-current" />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {chromeVisible &&
            (compact ? (
              <motion.div
                key="compact"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="dark pointer-events-none absolute inset-0 z-20 text-white"
              >
                {/* A wash so white controls read over bright footage. */}
                <div className="absolute inset-0 bg-black/25" />
                <div className="absolute inset-0 flex items-center justify-center gap-8">
                  <div className="pointer-events-auto" {...stopBubbling}>
                    <ControlButton label="Previous clip" onClick={transport.onPrev} disabled={!transport.canPrev} className="size-11 [&_svg]:size-6">
                      <SkipBack className="fill-current" />
                    </ControlButton>
                  </div>
                  <div className="pointer-events-auto" {...stopBubbling}>
                    <ControlButton label={effectivePaused ? "Play" : "Pause"} onClick={togglePlay} size="xl">
                      <PlayPauseGlyph paused={effectivePaused} />
                    </ControlButton>
                  </div>
                  <div className="pointer-events-auto" {...stopBubbling}>
                    <ControlButton label="Next clip" onClick={transport.onNext} disabled={!transport.canNext} className="size-11 [&_svg]:size-6">
                      <SkipForward className="fill-current" />
                    </ControlButton>
                  </div>
                </div>
                {/* Speed and full screen in the top corner, as iOS's player
                    keeps them, so the timeline gets the whole width. */}
                <div
                  className={cn(
                    "pointer-events-auto absolute top-0 right-0 z-[26] flex items-center gap-0.5 px-1.5 pt-1.5",
                    fullscreen.active && "pt-[calc(var(--safe-top)+0.5rem)]",
                  )}
                  {...stopBubbling}
                >
                  <SpeedMenu speed={speed} onSpeedChange={onSpeedChange} />
                  <FullscreenButton active={fullscreen.active} onToggle={fullscreen.toggle} />
                </div>
                {scrubber && (
                  <div
                    className={cn(
                      "pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-1",
                      fullscreen.layer && "pb-[calc(var(--safe-bottom)+0.25rem)]",
                    )}
                    {...stopBubbling}
                  >
                    {scrubber}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="chrome"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={springs.standard}
                {...stopBubbling}
                className={cn(
                  "dark absolute inset-x-3 bottom-3 z-20 flex flex-col gap-1 rounded-xl bg-black/55 px-3 pt-2.5 pb-2 text-white shadow-menu ring-1 ring-white/10 backdrop-blur-xl",
                  fullscreen.active && "mx-auto max-w-3xl",
                  fullscreen.layer && "bottom-[calc(var(--safe-bottom)+0.75rem)]",
                )}
              >
                {scrubber}
                <TransportBar
                  transport={transportProps}
                  speed={speed}
                  onSpeedChange={onSpeedChange}
                  fullscreen={fullscreen.active}
                  onToggleFullscreen={fullscreen.toggle}
                  readout={readout}
                />
              </motion.div>
            ))}
        </AnimatePresence>

        {fullscreen.active && (
          <AnimatePresence>
            {chromeVisible && (
              <motion.div
                key="fs-top"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={springs.standard}
                {...stopBubbling}
                className={cn(
                  "dark absolute inset-x-0 top-0 z-[25] flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pt-[calc(var(--safe-top)+0.75rem)] pb-10 sm:px-5",
                  // Room for the narrow layout's speed and full-screen buttons.
                  compact && "pr-28",
                )}
              >
                {/* An explicit way out: the layer has no Esc on a phone. */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 bg-black/40 text-white ring-white/25 hover:bg-black/60 hover:text-white"
                  onClick={() => fullscreen.exit()}
                >
                  <X />
                  Done
                </Button>
                {title && <span className="truncate text-sm font-medium text-white">{title}</span>}
                {readout && <span className="shrink-0 text-xs nums text-white/70">{readout}</span>}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </PortalContainerProvider>
    </div>
  );
}
