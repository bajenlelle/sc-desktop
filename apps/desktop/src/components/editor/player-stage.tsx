import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Minimize2, Pause, Play } from "lucide-react";
import {
  classifyMediaError,
  mediaFailureMessage,
  type MediaFailure,
} from "@scoutable/shared/lib/media-failure";
import type { CropKeyframe } from "@scoutable/shared/lib/crop-path";
import type { SlowRate } from "@scoutable/shared/lib/clip-timeline";
import { useAuth } from "@/lib/auth-context";
import { Sentry } from "@/lib/sentry";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { onSoundAnnounced, usePlayerSound } from "@/lib/player-sound";
import { cn } from "@/lib/utils";
import { ClipScrubber, formatLongTime } from "./clip-scrubber";
import { SoundIcon, TransportBar, TransportButtons, TransportTrail, type TransportProps } from "./transport-bar";

/** Local footage comes over the stream protocol — stream:// on macOS, http://stream.localhost on Windows. */
function isLocalSource(src: string): boolean {
  return src.startsWith("stream://") || src.includes("stream.localhost");
}

const IDLE_MS = 2500;

/**
 * The controls' height under the footage, one row at every width (.player-dock in index.css). Pages that fit
 * the footage to their column's height take it off.
 */
export const PLAYER_DOCK_HEIGHT = 44;

/** "0:31 / 20:50": where the video is, written straight into the node as it plays (no render a tick). */
function TimeReadout({ video, className }: { video: HTMLVideoElement; className?: string }) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  React.useEffect(() => {
    const write = () => {
      if (!ref.current) return;
      const length = Number.isFinite(video.duration) ? video.duration : 0;
      ref.current.textContent = `${formatLongTime(video.currentTime)} / ${formatLongTime(length)}`;
    };
    write();
    const events = ["timeupdate", "seeking", "seeked", "loadedmetadata", "durationchange", "emptied"] as const;
    for (const e of events) video.addEventListener(e, write);
    return () => {
      for (const e of events) video.removeEventListener(e, write);
    };
  }, [video]);
  return <span ref={ref} className={cn("block truncate pl-2 text-xs nums text-white/80", className)} />;
}

/** What a page can ask of the stage: Space toggles through here, so the key gets the same glyph as a click. */
export interface PlayerStageHandle {
  togglePlay: () => void;
}

export interface PlayerStageProps {
  /** The persistent element (usePersistentVideo); the stage hosts it. */
  video: HTMLVideoElement;
  /** Null until something has been chosen to play (the stage waits, black). */
  src: string | null;
  /**
   * The game's file is known to be gone (the caller shows its own panel for
   * that). The webview reports a missing file as "format not supported", so
   * without this the stage would cover that panel with the wrong advice.
   */
  fileMissing?: boolean;
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
  /**
   * Nothing to control (drawing, a card with its inspector, a file not yet probed): the docked controls stay
   * where they are, so nothing under them moves, but stand back, dimmed and inert.
   */
  hideChrome?: boolean;
  /**
   * A card (player, text or stats) is on the stage, not footage: the video
   * underneath keeps whatever the last clip left it with, and its error says
   * nothing about the card, so none is shown (or reported).
   */
  onCard?: boolean;
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
  /** A drawing holds the frame: the controls read "playing", and Play/Pause ends the hold where it stands. */
  hold?: { active: boolean; cancel: () => void };
  /** The active clip's drawings, as markers on the timeline (absolute time). */
  drawings?: { id: string; t: number; hold: number }[];
  onDrawingClick?: (id: string) => void;
  /** Slow-motion sections, as bands on the timeline (absolute time). */
  slows?: { id: string; t: number; length: number; rate: SlowRate }[];
  selectedSlowId?: string | null;
  onSlowClick?: (id: string) => void;
  /** Beside the transport, in place of "3 of 28": where the game is, when the stage plays a whole game. */
  readout?: string;
  /** The scrubber spans a whole game: its times read h:mm:ss. */
  longTimes?: boolean;
  /** Plain marks on the scrubber (absolute time): where each quarter starts. */
  ticks?: number[];
  /** What the scrubber is called when it isn't a clip's ("Position in the video"). */
  scrubLabel?: string;
  /** A scrub on the scrubber is over (a drag let go, a key's step). */
  onSeekEnd?: () => void;
  /** Without a scrubber (no clipWindow), the controls say "0:31 / 20:50": the game view, whose timeline is the scrubber. */
  timeReadout?: boolean;
}

/**
 * The footage with its controls docked under it, never over it: a broadcast
 * keeps its score and clock at the foot of the picture, and a sync is fixed
 * by reading them. The dock is the footage's black carried on, always there
 * (a clip's drawings, slow sections and keyframes stay in sight on its
 * scrubber). A click on the footage toggles playback with a brief glyph; a
 * spinner while the decoder is behind. The same stage serves the window and
 * the full-screen layer; in full screen the dock sits in the black bars when
 * the screen has room under the picture (16:10), and otherwise floats over
 * it as a bar that hides after a moment of stillness.
 */
export function PlayerStage({
  video,
  src,
  fileMissing,
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
  hideChrome = false,
  onCard = false,
  children,
  className,
  handleRef,
  playback,
  trimBar,
  hold,
  drawings,
  onDrawingClick,
  slows,
  selectedSlowId,
  onSlowClick,
  readout: readoutOverride,
  longTimes,
  ticks,
  scrubLabel,
  onSeekEnd,
  timeReadout = false,
}: PlayerStageProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Full screen: the room the screen leaves under a 16:9 picture as wide as it. Enough of it, and the
  // controls dock there as in the window.
  const [spare, setSpare] = React.useState(0);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!fullscreen || !root) return;
    const measure = () => setSpare(root.clientHeight - (root.clientWidth * 9) / 16);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [fullscreen]);
  // A trim bar is taller than the dock's row: in full screen it floats, as before, rather than push the picture off.
  const docked = !fullscreen || (!trimBar && spare >= PLAYER_DOCK_HEIGHT + 8);
  const [paused, setPaused] = React.useState(video.paused);
  const [buffering, setBuffering] = React.useState(false);
  const [failure, setFailure] = React.useState<MediaFailure | null>(null);
  // A failure of the video underneath says nothing about what is on screen
  // when the file is gone (the caller's panel covers that) or a card is up
  // (the element keeps whatever the previous clip left it with).
  const hideFailure = !!fileMissing || !!playback || onCard;
  const hideFailureRef = React.useRef(false);
  hideFailureRef.current = hideFailure;
  const [flash, setFlash] = React.useState<{ id: number; kind: "play" | "pause" | "sound" } | null>(null);
  const sound = usePlayerSound();
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

  // One volume and mute for every player (lib/player-sound.ts).
  React.useEffect(() => {
    video.volume = sound.volume;
    video.muted = sound.muted;
  }, [video, sound]);

  // M toggles sound while the controls may be hidden: say so on the footage.
  React.useEffect(() => onSoundAnnounced(() => setFlash({ id: Date.now(), kind: "sound" })), []);

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
      if (!kind || hideFailureRef.current) return;
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
  // A held frame is part of playback: the controls don't pin as for a pause.
  const shownPaused = playback ? playback.paused : paused && !hold?.active;
  const poke = React.useCallback(() => {
    setActive(true);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setActive(false), IDLE_MS);
  }, []);
  React.useEffect(() => {
    if (shownPaused) {
      setActive(true);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    } else {
      poke();
    }
  }, [shownPaused, poke]);
  React.useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );
  // Docked controls are always there; this is the floating bar's (and the full-screen top bar's) visibility.
  const chromeVisible = shownPaused || active || chromeHover;
  // A floating bar that goes away under the pointer never hears it leave: start over whenever the chrome changes kind.
  const controlsOffNow = !!fileMissing || hideChrome;
  const trimming = !!trimBar;
  React.useEffect(() => setChromeHover(false), [docked, controlsOffNow, trimming]);

  const togglePlay = React.useCallback(() => {
    if (playback) {
      setFlash({ id: Date.now(), kind: playback.paused ? "play" : "pause" });
      playback.toggle();
      return;
    }
    if (hold?.active) {
      hold.cancel();
      setFlash({ id: Date.now(), kind: "pause" });
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
  }, [video, transport, playback, hold]);

  React.useImperativeHandle(handleRef, () => ({ togglePlay }), [togglePlay]);

  const transportProps: TransportProps = {
    ...transport,
    paused: shownPaused,
    onTogglePlay: togglePlay,
  };

  const readout =
    readoutOverride ?? (position && position.total > 0 ? `${position.index + 1} of ${position.total}` : undefined);
  const clickable = interactive && !trimBar;

  const controlsOff = controlsOffNow;
  const scrubber = clipWindow ? (
    <ClipScrubber
      video={video}
      start={clipWindow.start}
      end={clipWindow.end}
      markers={markers}
      drawings={drawings}
      onDrawingClick={onDrawingClick}
      slows={slows}
      selectedSlowId={selectedSlowId}
      onSlowClick={onSlowClick}
      onSeek={onSeek}
      onScrubEnd={onSeekEnd}
      longTimes={longTimes}
      ticks={ticks}
      ariaLabel={scrubLabel}
    />
  ) : null;
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex flex-col",
        fullscreen ? "h-full w-full justify-center bg-black" : "w-full",
        fullscreen && !chromeVisible && "cursor-none",
        className,
      )}
      onPointerMove={poke}
      onPointerLeave={() => {
        if (!shownPaused) setActive(false);
      }}
      // On the root, so full screen's black bands around the picture answer too; the dock and the top bar stop
      // their own clicks.
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
      <div
        className={cn(
          "group/stage relative w-full overflow-hidden bg-black",
          fullscreen ? (docked ? "shrink-0" : "min-h-0 flex-1") : "rounded-t-lg",
        )}
        style={docked ? { aspectRatio: "16/9" } : undefined}
      >
        <div ref={hostRef} className="absolute inset-0 [&>video]:h-full [&>video]:w-full [&>video]:object-contain" />

        {children}

        {failure && !hideFailure && (
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
                {flash.kind === "sound" ? (
                  <SoundIcon volume={sound.volume} muted={sound.muted} />
                ) : flash.kind === "play" ? (
                  <Play className="translate-x-0.5 fill-current" />
                ) : (
                  <Pause className="fill-current" />
                )}
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

        {/* Full screen on a screen with no room under the picture: the controls float over it, and hide. With the
            file gone there is nothing to control, and the chrome would sit over the caller's "Locate file" button. */}
        {!docked && (
          <AnimatePresence>
            {fileMissing || hideChrome ? null : trimBar ? (
              <motion.div
                key="trim"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={springs.standard}
                {...stop}
                className="dark absolute inset-x-3 bottom-3 z-20 mx-auto max-w-3xl rounded-xl bg-black/60 px-3 pt-2.5 pb-2 text-white shadow-menu ring-1 ring-white/10 backdrop-blur-xl"
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
                {...stop}
                className="dark absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-3xl flex-col gap-1 rounded-xl bg-black/55 px-3 pt-2.5 pb-2 text-white shadow-menu ring-1 ring-white/10 backdrop-blur-xl"
              >
                {scrubber}
                <TransportBar
                  transport={transportProps}
                  speed={speed}
                  onSpeedChange={onSpeedChange}
                  fullscreen={fullscreen}
                  onToggleFullscreen={onToggleFullscreen}
                  readout={
                    !scrubber && timeReadout ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <TimeReadout video={video} className="inline pl-0" />
                        {readout && <span className="truncate text-white/70">{readout}</span>}
                      </span>
                    ) : (
                      readout
                    )
                  }
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        )}
      </div>

      {/* The controls, docked: the footage's black carried on under it, always there, so nothing under them
          moves. With nothing to control they stand back, dimmed and inert. */}
      {docked && (
        <div
          role="group"
          aria-label="Player controls"
          inert={controlsOff || undefined}
          // Pointing at the controls keeps the full-screen cursor and top bar, as the floating bar does.
          onPointerEnter={() => setChromeHover(true)}
          onPointerLeave={() => setChromeHover(false)}
          {...stop}
          className={cn(
            "player-dock dark relative z-20 w-full shrink-0 bg-black px-2 text-white",
            !fullscreen && "rounded-b-lg",
            // The controls dim, not the chin: the black stays the footage's.
            "[&>*]:transition-opacity [&>*]:duration-200 motion-reduce:[&>*]:transition-none",
            controlsOff && "[&>*]:opacity-40",
          )}
        >
          {trimBar ? (
            <div className="pt-2.5 pb-2">{trimBar}</div>
          ) : (
            // Full screen: the controls gather in the middle under the picture, as the floating bar does.
            <div className={cn("player-dock-row", fullscreen && "mx-auto max-w-4xl")}>
              <TransportButtons transport={transportProps} />
              <div className="min-w-0">{scrubber ?? (timeReadout ? <TimeReadout video={video} /> : null)}</div>
              <div className="flex min-w-0 items-center gap-1.5">
                {readout && <span className="dock-wide-only truncate pl-1 text-xs nums text-white/70">{readout}</span>}
                <TransportTrail speed={speed} onSpeedChange={onSpeedChange} fullscreen={fullscreen} onToggleFullscreen={onToggleFullscreen} />
              </div>
            </div>
          )}
        </div>
      )}

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
              {...stop}
              className="dark absolute inset-x-0 top-0 z-[25] flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-5 pt-4 pb-10"
            >
              {title && <span className="truncate text-sm font-medium text-white">{title}</span>}
              {/* Docked, the controls under the picture say it already, and they stay. */}
              {readout && !docked && <span className="shrink-0 text-xs nums text-white/70">{readout}</span>}
              <div className="flex-1" />
              {/* Esc is the OS's on macOS — an explicit exit must always exist. */}
              {onExitFullscreen && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 bg-black/40 text-white ring-1 ring-white/25 hover:bg-black/60 hover:text-white"
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
