import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoClipControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canPrev: boolean;
  canNext: boolean;
  isQueueActive: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onStop: () => void;
  onPlayAll?: () => void;
  activeClipPreOffset?: number;
  activeClipPostOffset?: number;
  onPreOffsetChange?: (delta: number) => void;
  onPostOffsetChange?: (delta: number) => void;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function VideoClipControls({
  videoRef,
  canPrev,
  canNext,
  isQueueActive,
  onPrev,
  onNext,
  onReplay,
  onStop,
  onPlayAll,
  activeClipPreOffset,
  activeClipPostOffset,
  onPreOffsetChange,
  onPostOffsetChange,
}: VideoClipControlsProps) {
  const preOffset = activeClipPreOffset ?? 0;
  const postOffset = activeClipPostOffset ?? 0;
  const [videoPaused, setVideoPaused] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoPaused(video.paused);
    const onPlay = () => setVideoPaused(false);
    const onPause = () => setVideoPaused(true);
    const onEnded = () => setVideoPaused(true);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoRef]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, videoRef]);

  useEffect(() => {
    if (!speedOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [speedOpen]);

  function togglePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (!isQueueActive && videoPaused && onPlayAll) {
      onPlayAll();
    } else if (videoPaused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  // Keep a ref to the latest togglePlayPause so the keydown listener never goes stale
  const togglePlayPauseRef = useRef(togglePlayPause);
  useLayoutEffect(() => { togglePlayPauseRef.current = togglePlayPause; });

  // Global spacebar → play/pause (skip when focus is inside a text field)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      togglePlayPauseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
    <div className="flex items-center justify-center gap-0.5">
      <CtrlBtn onClick={onPrev} disabled={!canPrev} title="Previous clip">
        <SkipBack className="h-5 w-5" />
      </CtrlBtn>

      <CtrlBtn onClick={onReplay} disabled={!isQueueActive} title="Replay clip">
        <RotateCcw className="h-[18px] w-[18px]" />
      </CtrlBtn>

      {/* Primary play/pause */}
      <button
        onClick={togglePlayPause}
        title={videoPaused ? "Play" : "Pause"}
        className="mx-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95"
      >
        {videoPaused ? (
          <Play className="h-5 w-5 translate-x-0.5 fill-current" />
        ) : (
          <Pause className="h-5 w-5 fill-current" />
        )}
      </button>

      <CtrlBtn onClick={onNext} disabled={!canNext} title="Next clip">
        <SkipForward className="h-5 w-5" />
      </CtrlBtn>

      <CtrlBtn onClick={onStop} disabled={!isQueueActive} title="Stop">
        <Square className="h-4 w-4 fill-current" />
      </CtrlBtn>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Speed dropdown */}
      <div ref={speedRef} className="relative">
        <button
          onClick={() => setSpeedOpen((v) => !v)}
          title="Playback speed"
          className={cn(
            "h-10 min-w-[3rem] rounded-lg px-1.5 text-xs font-semibold tabular-nums transition-all",
            "hover:bg-muted active:scale-95",
            speed !== 1 ? "text-primary" : "text-foreground/60 hover:text-foreground"
          )}
        >
          {speed === 1 ? "1×" : `${speed}×`}
        </button>

        {speedOpen && (
          <div className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => { setSpeed(s); setSpeedOpen(false); }}
                className={cn(
                  "flex w-full items-center justify-center px-4 py-1.5 text-xs font-medium tabular-nums transition-colors hover:bg-muted",
                  s === speed ? "text-primary" : "text-foreground/80"
                )}
              >
                {s === 1 ? "1×" : `${s}×`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>

    {isQueueActive && (onPreOffsetChange || onPostOffsetChange) && (
      <div className="mt-1.5 flex items-center justify-center gap-4 border-t border-border pt-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>Pre</span>
          <CtrlBtn small onClick={() => onPreOffsetChange?.(+1)} title="Pre-roll +1s">+</CtrlBtn>
          <span className={cn("w-8 text-center tabular-nums", preOffset !== 0 && "font-medium text-orange-400")}>
            {preOffset > 0 ? `+${preOffset}s` : `${preOffset}s`}
          </span>
          <CtrlBtn small onClick={() => onPreOffsetChange?.(-1)} title="Pre-roll −1s">−</CtrlBtn>
        </div>
        <div className="flex items-center gap-1">
          <span>Post</span>
          <CtrlBtn small onClick={() => onPostOffsetChange?.(-1)} title="Post-roll −1s">−</CtrlBtn>
          <span className={cn("w-8 text-center tabular-nums", postOffset !== 0 && "font-medium text-orange-400")}>
            {postOffset > 0 ? `+${postOffset}s` : `${postOffset}s`}
          </span>
          <CtrlBtn small onClick={() => onPostOffsetChange?.(+1)} title="Post-roll +1s">+</CtrlBtn>
        </div>
      </div>
    )}
    </div>
  );
}

function CtrlBtn({
  children,
  onClick,
  disabled,
  title,
  small,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center justify-center rounded-lg text-foreground/70 transition-all",
        small ? "h-6 w-6 text-xs" : "h-10 w-10",
        "hover:bg-muted hover:text-foreground",
        "active:scale-95",
        "disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground/70 disabled:active:scale-100"
      )}
    >
      {children}
    </button>
  );
}
