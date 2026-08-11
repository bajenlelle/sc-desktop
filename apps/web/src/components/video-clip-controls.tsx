"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from "lucide-react";
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
}: VideoClipControlsProps) {
  const [videoPaused, setVideoPaused] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);
  // Phones only get prev / play / next inline; the rest lives behind this.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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
  }, [videoRef, isQueueActive]);

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

  useEffect(() => {
    if (!moreOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [moreOpen]);

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

  const togglePlayPauseRef = useRef(togglePlayPause);
  useLayoutEffect(() => { togglePlayPauseRef.current = togglePlayPause; });

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

        <CtrlBtn onClick={onReplay} disabled={!isQueueActive} title="Replay clip" className="hidden lg:flex">
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

        <CtrlBtn onClick={onStop} disabled={!isQueueActive} title="Stop" className="hidden lg:flex">
          <Square className="h-4 w-4 fill-current" />
        </CtrlBtn>

        {/* Overflow — replay / stop / speed, phone only */}
        <div ref={moreRef} className="relative lg:hidden">
          <CtrlBtn onClick={() => setMoreOpen((v) => !v)} title="More">
            <MoreHorizontal className="h-5 w-5" />
          </CtrlBtn>
          {moreOpen && (
            <div className="absolute bottom-full right-0 mb-1.5 min-w-[9rem] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              <button
                onClick={() => { onReplay(); setMoreOpen(false); }}
                disabled={!isQueueActive}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 text-sm text-foreground/90 disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" /> Replay
              </button>
              <button
                onClick={() => { onStop(); setMoreOpen(false); }}
                disabled={!isQueueActive}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 text-sm text-foreground/90 disabled:opacity-40"
              >
                <Square className="h-3.5 w-3.5 fill-current" /> Stop
              </button>
              <div className="h-px bg-border" />
              <div className="flex flex-wrap gap-1 p-2">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setSpeed(s); setMoreOpen(false); }}
                    className={cn(
                      "min-h-[36px] min-w-[44px] rounded-md px-2 text-xs font-medium tabular-nums",
                      s === speed ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80"
                    )}
                  >
                    {s === 1 ? "1×" : `${s}×`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mx-1 hidden h-5 w-px bg-border lg:block" />

        {/* Speed dropdown — desktop */}
        <div ref={speedRef} className="relative hidden lg:block">
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
    </div>
  );
}

function CtrlBtn({
  children,
  onClick,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center justify-center rounded-lg text-foreground/70 transition-all",
        // 44px on touch, tighter once there's a pointer.
        "h-11 w-11 lg:h-10 lg:w-10",
        "hover:bg-muted hover:text-foreground",
        "active:scale-95",
        "disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground/70 disabled:active:scale-100",
        className
      )}
    >
      {children}
    </button>
  );
}
