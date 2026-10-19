import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Minimize2, Pause, Play } from "lucide-react";
import {
  classifyMediaError,
  mediaFailureMessage,
  type MediaFailure,
} from "@scoutable/shared/lib/media-failure";
import type { CropKeyframe } from "@scoutable/shared/lib/crop-path";
import { useAuth } from "@/lib/auth-context";
import { Sentry } from "@/lib/sentry";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ClipScrubber } from "./clip-scrubber";
import { TransportBar, type TransportProps } from "./transport-bar";

/** Local footage comes over the stream protocol — stream:// on macOS, http://stream.localhost on Windows. */
function isLocalSource(src: string): boolean {
  return src.startsWith("stream://") || src.includes("stream.localhost");
}

const IDLE_MS = 2500;

/** What a page can ask of the stage: Space toggles through here, so the key gets the same glyph as a click. */
export interface PlayerStageHandle {
  togglePlay: () => void;
}

export interface PlayerStageProps {
  /** The persistent element (usePersistentVideo); the stage hosts it. */
  video: HTMLVideoElement;
  /** Null until something has been chosen to play (the stage waits, black). */
  src: string | null;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onExitFullscreen?: () => void;
  /** Fullscreen top bar. */
  title?: string;
  position?: { index: number; total: number } | null;
  /** The active clip's window; no scrubber without one. */
  clipWindow?: { start: number; end: number } | null;
  markers?: CropKeyframe[];
  onSeek: (t: number) => void;
  transport: Omit<TransportProps, "paused" | "onTogglePlay"> & { onPlayAll?: () => void };
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** False while another layer (the crop window) owns the pointer. */
  interactive?: boolean;
  /** Overlays stacked on the footage (crop window, missing file, text card). */
  children?: React.ReactNode;
  className?: string;
  handleRef?: React.Ref<PlayerStageHandle>;
  /** Something other than the footage is playing (a timed text card): its state drives the controls. */
  playback?: { paused: boolean; toggle: () => void };
  /**
   * Trimming: this bar (ClipTrimmer) replaces the transport, pinned in the
   * same material, and a click on the footage no longer toggles playback.
   */
  trimBar?: React.ReactNode;
}

/**
 * The footage with its controls floating over it, QuickTime-style: a
 * translucent bar that shows while paused or when the pointer moves and
 * hides after a moment of stillness during playback; a click on the
 * footage toggles playback with a brief glyph; a spinner while the decoder
 * is behind. The same stage serves the window and the fullscreen layer.
 */
export function PlayerStage({
  video,
  src,
  fullscreen = false,
  onToggleFullscreen,
  onExitFullscreen,
  title,
  position,
  clipWindow,
  markers,
  onSeek,
  transport,
  speed,
  onSpeedChange,
  interactive = true,
  children,
  className,
  handleRef,
  playback,
  trimBar,
}: PlayerStageProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = React.useState(video.paused);
  const [buffering, setBuffering] = React.useState(false);
  const [failure, setFailure] = React.useState<MediaFailure | null>(null);
  const [flash, setFlash] = React.useState<{ id: number; kind: "play" | "pause" } | null>(null);
  const [active, setActive] = React.useState(true);
  const [chromeHover, setChromeHover] = React.useState(false);
  const idleTimer = React.useRef<number | null>(null);
  const reduced = useReducedMotionSafe();
  // Free-tier corner mark: free users can't export, and this closes the
  // screen-record workaround. Rendered only once the plan is known so it
  // never flashes for paying users.
  const { activeOrgPlan, profileLoading } = useAuth();
  const showWatermark = !profileLoading && activeOrgPlan === "free";

  // Host the persistent element. Removal and re-insertion happen within one
  // commit when the stage moves between layouts, so playback continues.
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.appendChild(video);
    return () => {
      if (video.parentNode === host) host.removeChild(video);
    };
  }, [video]);

  React.useEffect(() => {
    if (src && video.getAttribute("src") !== src) {
      video.src = src;
    }
    video.playbackRate = speed;
  }, [video, src, speed]);

  // Media state → UI. Why the box is black, when it is: every player used to
  // go silently dark; the only report was an unhandled play() rejection.
  React.useEffect(() => {
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
    function report(kind: MediaFailure | null) {
      setFailure(kind);
      if (!kind) return;
      Sentry.captureMessage("video failed to load", {
        level: "warning",
        tags: {
          kind,
          media_error_code: String(video.error?.code ?? 0),
          ext: src?.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? "none",
          local: String(!!src && isLocalSource(src)),
        },
      });
    }
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onEnded = () => setPaused(true);
    const onError = () => {
      clearBuffering();
      report(classifyMediaError(video.error?.code));
    };
    // Audio decodes but the video codec doesn't (iPhone HEVC on Windows):
    // no error event at all, just a picture-less element.
    const onLoadedMetadata = () => {
      if (video.videoWidth === 0) report("no_picture");
    };
    const onLoadStart = () => {
      report(null);
      armBuffering();
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("waiting", armBuffering);
    video.addEventListener("stalled", armBuffering);
    video.addEventListener("seeking", armBuffering);
    video.addEventListener("playing", clearBuffering);
    video.addEventListener("canplay", clearBuffering);
    video.addEventListener("seeked", clearBuffering);
    video.addEventListener("error", onError);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadstart", onLoadStart);
    setPaused(video.paused);
    if (video.error) onError();
    return () => {
      clearBuffering();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("waiting", armBuffering);
      video.removeEventListener("stalled", armBuffering);
      video.removeEventListener("seeking", armBuffering);
      video.removeEventListener("playing", clearBuffering);
      video.removeEventListener("canplay", clearBuffering);
      video.removeEventListener("seeked", clearBuffering);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadstart", onLoadStart);
    };
  }, [video, src]);

  // Chrome visibility: any pointer movement on the stage shows it and arms
  // the idle timer; while paused or hovering the bar it never hides.
  const poke = React.useCallback(() => {
    setActive(true);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setActive(false), IDLE_MS);
  }, []);
  React.useEffect(() => {
    if (paused) {
      setActive(true);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    } else {
      poke();
    }
  }, [paused, poke]);
  React.useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );
  const chromeVisible = (playback ? playback.paused : paused) || active || chromeHover;

  const togglePlay = React.useCallback(() => {
    if (playback) {
      setFlash({ id: Date.now(), kind: playback.paused ? "play" : "pause" });
      playback.toggle();
      return;
    }
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

  const transportProps: TransportProps = {
    ...transport,
    paused: playback ? playback.paused : paused,
    onTogglePlay: togglePlay,
  };

  const readout =
    position && position.total > 0 ? `${position.index + 1} of ${position.total}` : undefined;
  const clickable = interactive && !trimBar;

  return (
    <div
      ref={stageRef}
      className={cn(
        "group/stage relative overflow-hidden bg-black",
        fullscreen ? "h-full w-full" : "w-full rounded-lg",
        fullscreen && !chromeVisible && "cursor-none",
        className,
      )}
      style={fullscreen ? undefined : { aspectRatio: "16/9" }}
      onPointerMove={poke}
      onPointerLeave={() => {
        if (!paused) setActive(false);
      }}
      onClick={
        clickable
          ? (e) => {
              // The second click of a double-click is the fullscreen gesture,
              // not a second toggle.
              if (e.detail > 1) return;
              togglePlay();
            }
          : undefined
      }
      onDoubleClick={clickable && onToggleFullscreen ? onToggleFullscreen : undefined}
    >
      <div ref={hostRef} className="absolute inset-0 [&>video]:h-full [&>video]:w-full [&>video]:object-contain" />

      {children}

      {failure && (
        <div
          role="alert"
          className="absolute inset-0 z-[13] flex items-center justify-center bg-black/80 p-6 text-center text-sm text-white"
        >
          <p className="max-w-sm">{mediaFailureMessage(failure, { remote: !src || !isLocalSource(src) })}</p>
        </div>
      )}

      {buffering && !failure && (
        <div className="pointer-events-none absolute inset-0 z-[14] flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-white/80 drop-shadow" />
        </div>
      )}

      {/* The press, acknowledged on the footage itself. */}
      <AnimatePresence>
        {flash && (
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

      {showWatermark && (
        // Bare letterforms + cyan dot (no box). The `dark` wrapper forces the
        // light fill regardless of app theme — footage is the background.
        <div
          aria-hidden
          className="dark pointer-events-none absolute right-[2.5%] bottom-[16%] z-[16] w-[18%] max-w-60 min-w-28 opacity-70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] select-none"
        >
          <Wordmark className="h-auto w-full" />
        </div>
      )}

      {/* Floating chrome, or the trim bar in its place */}
      <AnimatePresence>
        {trimBar ? (
          <motion.div
            key="trim"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={springs.standard}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              "dark absolute inset-x-3 bottom-3 z-20 rounded-xl bg-black/60 px-3 pt-2.5 pb-2 text-white shadow-menu ring-1 ring-white/10 backdrop-blur-xl",
              fullscreen && "mx-auto max-w-3xl",
            )}
          >
            {trimBar}
          </motion.div>
        ) : chromeVisible ? (
          <motion.div
            key="chrome"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={springs.standard}
            onPointerEnter={() => setChromeHover(true)}
            onPointerLeave={() => setChromeHover(false)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              "dark absolute inset-x-3 bottom-3 z-20 flex flex-col gap-1 rounded-xl bg-black/55 px-3 pt-2.5 pb-2 text-white shadow-menu ring-1 ring-white/10 backdrop-blur-xl",
              fullscreen && "mx-auto max-w-3xl",
            )}
          >
            {clipWindow && (
              <ClipScrubber
                video={video}
                start={clipWindow.start}
                end={clipWindow.end}
                markers={markers}
                onSeek={onSeek}
              />
            )}
            <TransportBar
              transport={transportProps}
              speed={speed}
              onSpeedChange={onSpeedChange}
              fullscreen={fullscreen}
              onToggleFullscreen={onToggleFullscreen}
              readout={readout}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {fullscreen && (
        <AnimatePresence>
          {chromeVisible && (
            <motion.div
              key="fs-top"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springs.standard}
              onPointerEnter={() => setChromeHover(true)}
              onPointerLeave={() => setChromeHover(false)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="dark absolute inset-x-0 top-0 z-[25] flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-5 pt-4 pb-10"
            >
              {title && <span className="truncate text-sm font-medium text-white">{title}</span>}
              {readout && <span className="shrink-0 text-xs nums text-white/70">{readout}</span>}
              <div className="flex-1" />
              {/* Esc is the OS's on macOS — an explicit exit must always exist. */}
              {onExitFullscreen && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 bg-black/40 text-white ring-white/25 hover:bg-black/60 hover:text-white"
                  onClick={onExitFullscreen}
                >
                  <Minimize2 />
                  Exit full screen
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
