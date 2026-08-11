"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, Check } from "lucide-react";
import { VideoPlayer } from "@/components/video-player";
import { Button } from "@/components/ui/button";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { cn } from "@/lib/utils";

export interface SyncPointPickerProps {
  videoPath: string;
  tipoffHint?: string;
  initialSeconds?: number;
  onConfirm: (seconds: number) => void;
  onSkip?: () => void;
}

function formatMSSd(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const d = Math.floor((secs % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

export function SyncPointPicker({
  videoPath,
  tipoffHint,
  initialSeconds,
  onConfirm,
  onSkip,
}: SyncPointPickerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const wasPlayingRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(initialSeconds ?? 0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [confirmedTime, setConfirmedTime] = useState<number | null>(initialSeconds ?? null);

  // The sample game's video is a remote R2 URL, not a local file.
  const src = isLocalPath(videoPath) ? streamFileSrc(videoPath) : videoPath;

  // Wire up video events
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
      if (!video || isDraggingRef.current) return;
      setCurrentTime(video.currentTime);
    }

    function onPlay() { setPlaying(true); }
    function onPause() { setPlaying(false); }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    // Already loaded
    if (video.readyState >= 1) {
      setDuration(video.duration);
      if (initialSeconds != null && initialSeconds > 0) {
        video.currentTime = initialSeconds;
        setCurrentTime(initialSeconds);
      }
    }

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [initialSeconds]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play(); } else { video.pause(); }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
    video.currentTime = next;
    setCurrentTime(next);
    setConfirmedTime(null);
  }, []);

  // Keyboard shortcuts (window-level so they work without focus tricks)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't steal keys from other inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(e.shiftKey ? -10 : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(e.shiftKey ? 10 : 1);
          break;
        case "j":
          seekBy(-1);
          break;
        case "k":
          videoRef.current?.pause();
          break;
        case "l":
          seekBy(1);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, seekBy]);

  function handleScrubberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) video.currentTime = value;
    setCurrentTime(value);
  }

  function handleScrubberMouseDown() {
    const video = videoRef.current;
    if (!video) return;
    wasPlayingRef.current = !video.paused;
    isDraggingRef.current = true;
    video.pause();
    setConfirmedTime(null);
  }

  function handleScrubberRelease() {
    isDraggingRef.current = false;
    if (wasPlayingRef.current) {
      videoRef.current?.play();
    }
  }

  return (
    <div ref={containerRef} className="space-y-3 outline-none" tabIndex={-1}>
      {/* Prompt */}
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">Set the tip-off point</p>
        <p className="text-xs text-muted-foreground">
          Scrub to the exact frame when the ball is tipped, then click{" "}
          <span className="text-foreground font-medium">Set tip-off here</span>.
        </p>
      </div>

      {/* Video */}
      <VideoPlayer src={src} videoRef={videoRef} />

      {/* Scrubber */}
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
          {formatMSSd(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleScrubberChange}
          onMouseDown={handleScrubberMouseDown}
          onMouseUp={handleScrubberRelease}
          onTouchEnd={handleScrubberRelease}
          className="scrubber h-1 flex-1 cursor-pointer"
        />
        <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
          {formatMSSd(duration)}
        </span>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 font-mono text-xs text-muted-foreground"
            onClick={() => seekBy(-10)}
            title="Back 10s (Shift+←)"
          >
            ← 10s
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 font-mono text-xs text-muted-foreground"
            onClick={() => seekBy(-1)}
            title="Back 1s (←)"
          >
            ← 1s
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={togglePlay}
            title="Play / Pause (Space)"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 font-mono text-xs text-muted-foreground"
            onClick={() => seekBy(1)}
            title="Forward 1s (→)"
          >
            1s →
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 font-mono text-xs text-muted-foreground"
            onClick={() => seekBy(10)}
            title="Forward 10s (Shift+→)"
          >
            10s →
          </Button>
        </div>
        <span className="text-2xl font-mono tabular-nums text-foreground">
          {formatMSSd(currentTime)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          className={cn(
            "flex-1",
            confirmedTime !== null && "border-emerald-600 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          )}
          variant={confirmedTime !== null ? "outline" : "default"}
          onClick={() => {
            setConfirmedTime(currentTime);
            onConfirm(currentTime);
          }}
        >
          {confirmedTime !== null ? (
            <>
              <Check className="mr-1.5 h-4 w-4" />
              Tip-off set — {formatMSSd(confirmedTime)}
            </>
          ) : (
            "Set tip-off here"
          )}
        </Button>
        {onSkip && (
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
