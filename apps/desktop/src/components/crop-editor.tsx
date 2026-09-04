/**
 * Vertical-crop editor for 9:16 exports — the "moving window" UI.
 *
 * CropOverlay draws a draggable 9:16 window over the video with dimmed
 * surroundings. Dragging saves a keyframe { t: currentTime, cx } for the
 * active clip; during playback a requestAnimationFrame loop (timeupdate is
 * ~4 Hz in WKWebView — far too coarse) moves the window along the SAME
 * interpolation (`cxAt` from @scoutable/shared/lib/crop-path) the ffmpeg
 * export bakes in, so the preview pan is exactly the exported pan.
 *
 * Everything is plain divs — the player's WKWebView freeze-frame workaround
 * (video-player.tsx) breaks if a canvas is composited over the video.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RectangleVertical, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clampCx,
  cropWidthFrac,
  cxAt,
  type CropKeyframe,
} from "@scoutable/shared/lib/crop-path";

/** Merge tolerance: a drag at (nearly) the same playhead edits that keyframe. */
export const KEYFRAME_MERGE_EPSILON = 0.25;

export function upsertKeyframe(
  keyframes: CropKeyframe[] | undefined,
  t: number,
  cx: number,
): CropKeyframe[] {
  const kfs = (keyframes ?? []).filter((k) => Math.abs(k.t - t) > KEYFRAME_MERGE_EPSILON);
  kfs.push({ t, cx });
  kfs.sort((a, b) => a.t - b.t);
  return kfs;
}

export function CropOverlay({
  videoRef,
  keyframes,
  dimmed,
  onCommit,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  keyframes: CropKeyframe[] | undefined;
  /** true = near-black surroundings — a "what the export shows" preview. */
  dimmed: boolean;
  /** Drag finished: persist a keyframe at this time/center. */
  onCommit: (t: number, cx: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const maskLeftRef = useRef<HTMLDivElement | null>(null);
  const maskRightRef = useRef<HTMLDivElement | null>(null);
  const keyframesRef = useRef<CropKeyframe[] | undefined>(keyframes);
  keyframesRef.current = keyframes;
  const dragRef = useRef<{ startX: number; startCx: number; cx: number } | null>(null);
  // 16:9 source default until loadedmetadata reports the real dimensions.
  const [wFrac, setWFrac] = useState(cropWidthFrac(16, 9));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setWFrac(cropWidthFrac(video.videoWidth, video.videoHeight));
      }
    };
    update();
    video.addEventListener("loadedmetadata", update);
    return () => video.removeEventListener("loadedmetadata", update);
  }, [videoRef]);

  // Positioning happens outside React: the rAF loop writes styles directly so
  // a 60fps pan never re-renders the page component.
  const applyCx = useCallback(
    (cx: number) => {
      const container = containerRef.current;
      const win = windowRef.current;
      const left = maskLeftRef.current;
      const right = maskRightRef.current;
      if (!container || !win || !left || !right) return;
      const cw = container.clientWidth;
      const clamped = clampCx(cx, wFrac);
      const winW = wFrac * cw;
      const winLeft = clamped * cw - winW / 2;
      win.style.left = `${winLeft}px`;
      win.style.width = `${winW}px`;
      left.style.width = `${Math.max(0, winLeft)}px`;
      right.style.width = `${Math.max(0, cw - winLeft - winW)}px`;
    },
    [wFrac],
  );

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const cx = dragRef.current
          ? dragRef.current.cx
          : cxAt(keyframesRef.current, video.currentTime);
        applyCx(cx);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, applyCx]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;
    // Predictable authoring: the keyframe lands at the paused playhead.
    video.pause();
    const startCx = clampCx(cxAt(keyframesRef.current, video.currentTime), wFrac);
    dragRef.current = { startX: e.clientX, startCx, cx: startCx };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    const dx = (e.clientX - drag.startX) / container.clientWidth;
    drag.cx = clampCx(drag.startCx + dx, wFrac);
    applyCx(drag.cx);
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    const video = videoRef.current;
    dragRef.current = null;
    if (!drag || !video) return;
    onCommit(video.currentTime, drag.cx);
  }

  const maskClass = dimmed ? "bg-black/90" : "bg-black/60";

  return (
    <div ref={containerRef} className="absolute inset-0 z-[5] overflow-hidden">
      <div ref={maskLeftRef} className={`absolute inset-y-0 left-0 ${maskClass}`} />
      <div ref={maskRightRef} className={`absolute inset-y-0 right-0 ${maskClass}`} />
      <div
        ref={windowRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute inset-y-0 cursor-grab active:cursor-grabbing touch-none select-none"
      >
        {!dimmed && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-sm border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
            {/* Platform-UI safe band: Reels/TikTok cover ~top 14% and bottom
                35% — keep the player between the lines. */}
            <div className="pointer-events-none absolute inset-x-1 top-[14%] border-t border-dashed border-white/35" />
            <div className="pointer-events-none absolute inset-x-1 bottom-[35%] border-t border-dashed border-white/35" />
          </>
        )}
      </div>
    </div>
  );
}

function formatClipTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Playback timeline for the ACTIVE CLIP's window (not the whole game file):
 * elapsed/total time, click-or-drag scrubbing, and a live playhead —
 * rAF-driven (WKWebView's timeupdate is ~4 Hz). In crop mode the pan
 * keyframes render as jump-to dots; otherwise pass no keyframes and it's a
 * plain scrubber.
 */
export function ClipTimeline({
  videoRef,
  keyframes,
  clipStart,
  clipEnd,
  onSeek,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  keyframes: CropKeyframe[] | undefined;
  clipStart: number;
  clipEnd: number;
  onSeek: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const scrubbingRef = useRef(false);
  const duration = Math.max(0.001, clipEnd - clipStart);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const frac = Math.min(1, Math.max(0, (video.currentTime - clipStart) / duration));
        if (playheadRef.current) playheadRef.current.style.left = `${frac * 100}%`;
        if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
        if (timeRef.current) {
          timeRef.current.textContent = formatClipTime(video.currentTime - clipStart);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, clipStart, duration]);

  function seekFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(clipStart + frac * duration);
  }

  return (
    <div className="flex items-center gap-2 px-1">
      <span ref={timeRef} className="w-9 text-right text-xs tabular-nums text-muted-foreground">
        0:00
      </span>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          scrubbingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (scrubbingRef.current) seekFromPointer(e);
        }}
        onPointerUp={() => {
          scrubbingRef.current = false;
        }}
        className="relative h-6 flex-1 cursor-pointer touch-none select-none"
        title="Click or drag to move the playhead"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted">
          <div ref={fillRef} className="h-full rounded-full bg-primary/30" style={{ width: 0 }} />
        </div>
        {(keyframes ?? []).map((k) => {
          const frac = Math.min(1, Math.max(0, (k.t - clipStart) / duration));
          return (
            <button
              key={`${k.t}`}
              type="button"
              title={`Keyframe at ${formatClipTime(k.t - clipStart)} — click to jump`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(k.t);
              }}
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-primary shadow hover:scale-125 transition-transform"
              style={{ left: `${frac * 100}%` }}
            />
          );
        })}
        <div
          ref={playheadRef}
          className="pointer-events-none absolute top-0 h-6 w-0.5 -translate-x-1/2 rounded bg-foreground"
          style={{ left: 0 }}
        />
      </div>
      <span className="w-9 text-xs tabular-nums text-muted-foreground">
        {formatClipTime(duration)}
      </span>
    </div>
  );
}

export function CropEditorBar({
  active,
  onToggle,
  dimmed,
  onToggleDimmed,
  keyframeCount,
  onRemoveAtPlayhead,
  onReset,
}: {
  active: boolean;
  onToggle: () => void;
  dimmed: boolean;
  onToggleDimmed: () => void;
  keyframeCount: number;
  onRemoveAtPlayhead: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      <Button
        size="sm"
        variant={active ? "default" : "outline"}
        className="h-7 gap-1.5 text-xs"
        onClick={onToggle}
        title="Position the 9:16 window used by vertical exports"
      >
        <RectangleVertical className="h-3.5 w-3.5" />
        Vertical crop
      </Button>
      {active && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={onToggleDimmed}
            title={dimmed ? "Show the full frame while editing" : "Preview exactly what the export shows"}
          >
            {dimmed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            Preview
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={onRemoveAtPlayhead}
            disabled={keyframeCount === 0}
            title="Remove the keyframe nearest the playhead"
          >
            <X className="h-3.5 w-3.5" />
            Remove keyframe
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={onReset}
            disabled={keyframeCount === 0}
            title="Clear the pan — back to a static centered crop"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <span className="text-xs text-muted-foreground">
            {keyframeCount === 0
              ? "Drag the window over the video — each drag saves a keyframe at the playhead"
              : `${keyframeCount} keyframe${keyframeCount !== 1 ? "s" : ""} — the window pans between them`}
          </span>
        </>
      )}
    </div>
  );
}
