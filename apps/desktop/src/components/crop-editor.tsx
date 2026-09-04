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
  clipStart,
  clipEnd,
  dimmed,
  onCommit,
  onSeek,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  keyframes: CropKeyframe[] | undefined;
  /** Active clip's bounds in source-video seconds (for the keyframe strip). */
  clipStart: number | null;
  clipEnd: number | null;
  /** true = near-black surroundings — a "what the export shows" preview. */
  dimmed: boolean;
  /** Drag finished: persist a keyframe at this time/center. */
  onCommit: (t: number, cx: number) => void;
  onSeek: (t: number) => void;
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

  const clipDuration = clipStart !== null && clipEnd !== null ? clipEnd - clipStart : null;
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
      {/* Keyframe strip: dots along the clip's own timeline. */}
      {clipDuration !== null && clipDuration > 0 && (keyframes?.length ?? 0) > 0 && (
        <div className="pointer-events-none absolute inset-x-3 bottom-1.5 h-4">
          {keyframes!.map((k) => {
            const frac = Math.min(1, Math.max(0, (k.t - clipStart!) / clipDuration));
            return (
              <button
                key={`${k.t}`}
                type="button"
                title={`Keyframe at ${(k.t - clipStart!).toFixed(1)}s — click to jump`}
                onClick={() => onSeek(k.t)}
                className="pointer-events-auto absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full border border-black/40 bg-primary shadow"
                style={{ left: `${frac * 100}%` }}
              />
            );
          })}
        </div>
      )}
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
