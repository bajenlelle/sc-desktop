import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import type { CropKeyframe } from "@scoutable/shared/lib/crop-path";
import { clamp, rubberband } from "@scoutable/shared/lib/motion-math";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

function formatClipTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

const THUMB_HIT = 10;

/**
 * The active clip's timeline, built like NSSlider: pressing the thumb keeps
 * the grab offset, pressing the track jumps, the thumb tracks the pointer
 * 1:1 (one seek per frame, never while the decoder is still seeking),
 * rubber-bands past the ends and springs back on release. Scrubbing pauses
 * the video and resumes it on release if it was playing: finding the frame
 * is the task. Keys on the focused slider nudge by a second (Shift: ten) or
 * a frame (`,` and `.`).
 */
export function ClipScrubber({
  video,
  start,
  end,
  markers,
  onSeek,
  frameSeconds = 1 / 25,
  className,
}: {
  video: HTMLVideoElement;
  start: number;
  end: number;
  markers?: CropKeyframe[];
  onSeek: (t: number) => void;
  frameSeconds?: number;
  className?: string;
}) {
  const duration = Math.max(0.001, end - start);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const thumbX = useMotionValue(0);
  const [pressed, setPressed] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState(0);
  const scrubRef = useRef<{ grabOffset: number; wasPlaying: boolean; pendingTime: number | null; raf: number } | null>(null);

  const fractionToX = useCallback((frac: number) => {
    const width = trackRef.current?.clientWidth ?? 0;
    return frac * width;
  }, []);

  const paint = useCallback(
    (time: number) => {
      const frac = clamp((time - start) / duration, 0, 1);
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${frac})`;
      if (elapsedRef.current) elapsedRef.current.textContent = formatClipTime(time - start);
      return frac;
    },
    [start, duration],
  );

  // Follow playback at the display rate (timeupdate is ~4 Hz in WKWebView);
  // while scrubbing the pointer drives the thumb instead.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (!scrubRef.current) thumbX.set(fractionToX(paint(video.currentTime)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, paint, fractionToX, thumbX]);

  function timeAtPointer(clientX: number, grabOffset = 0) {
    const track = trackRef.current;
    if (!track) return { time: start, raw: 0, width: 0 };
    const rect = track.getBoundingClientRect();
    const raw = clientX - rect.left - grabOffset;
    const frac = clamp(raw / rect.width, 0, 1);
    return { time: start + frac * duration, raw, width: rect.width };
  }

  function flushSeek() {
    const s = scrubRef.current;
    if (!s) return;
    s.raf = 0;
    if (s.pendingTime === null) return;
    if (video.seeking) {
      s.raf = requestAnimationFrame(flushSeek);
      return;
    }
    const t = s.pendingTime;
    s.pendingTime = null;
    onSeek(t);
  }

  function scheduleSeek(t: number) {
    const s = scrubRef.current;
    if (!s) return;
    s.pendingTime = t;
    if (!s.raf) s.raf = requestAnimationFrame(flushSeek);
  }

  function moveThumb(clientX: number) {
    const s = scrubRef.current;
    if (!s) return;
    const { time, raw, width } = timeAtPointer(clientX, s.grabOffset);
    // Past either end the thumb resists instead of stopping dead.
    const over = raw < 0 ? raw : raw > width ? raw - width : 0;
    thumbX.set(clamp(raw, 0, width) + rubberband(over, width));
    paint(time);
    setHoverTime(time);
    scheduleSeek(time);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const thumbAt = thumbX.get();
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const onThumb = Math.abs(localX - thumbAt) <= THUMB_HIT;
    scrubRef.current = {
      grabOffset: onThumb ? localX - thumbAt : 0,
      wasPlaying: !video.paused,
      pendingTime: null,
      raf: 0,
    };
    if (!video.paused) video.pause();
    setPressed(true);
    moveThumb(e.clientX);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    setHoverX(clamp(localX, 0, rect.width));
    if (scrubRef.current) moveThumb(e.clientX);
    else setHoverTime(timeAtPointer(e.clientX).time);
  }

  function endScrub() {
    const s = scrubRef.current;
    if (!s) return;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.pendingTime !== null) onSeek(s.pendingTime);
    scrubRef.current = null;
    setPressed(false);
    const width = trackRef.current?.clientWidth ?? 0;
    const settled = clamp(thumbX.get(), 0, width);
    if (settled !== thumbX.get()) animate(thumbX, settled, springs.settle);
    if (s.wasPlaying) video.play().catch(() => {});
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let delta = 0;
    if (e.key === "ArrowLeft") delta = e.shiftKey ? -10 : -1;
    else if (e.key === "ArrowRight") delta = e.shiftKey ? 10 : 1;
    else if (e.key === ",") delta = -frameSeconds;
    else if (e.key === ".") delta = frameSeconds;
    else if (e.key === "Home") delta = -Infinity;
    else if (e.key === "End") delta = Infinity;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(clamp(video.currentTime + delta, start, end));
  }

  const elapsedNow = clamp(video.currentTime - start, 0, duration);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span ref={elapsedRef} className="w-10 text-right text-xs nums text-white/80">
        {formatClipTime(elapsedNow)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Clip position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(elapsedNow * 10) / 10}
        aria-valuetext={formatClipTime(elapsedNow)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
        onPointerLeave={() => setHoverX(null)}
        onKeyDown={onKeyDown}
        className="group/track relative h-6 flex-1 cursor-default touch-none select-none outline-none focus-visible:[&>div:first-child]:ring-2 focus-visible:[&>div:first-child]:ring-white/60"
      >
        {/* Track: grows on hover like a QuickTime scrubber. */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/track:h-2">
          <div ref={fillRef} className="h-full w-full origin-left rounded-full bg-white/90" style={{ transform: "scaleX(0)" }} />
        </div>
        {(markers ?? []).map((k) => {
          const frac = clamp((k.t - start) / duration, 0, 1);
          return (
            <button
              key={`${k.t}`}
              type="button"
              title={`Keyframe at ${formatClipTime(k.t - start)}. Click to jump`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(k.t);
              }}
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 bg-primary shadow transition-transform duration-100 hover:scale-125 active:scale-110"
              style={{ left: `${frac * 100}%` }}
            />
          );
        })}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.5)]"
          style={{ x: thumbX }}
          animate={{ scale: pressed ? 1.4 : 1 }}
          transition={springs.snappy}
        />
        {hoverX !== null && (
          <div
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] nums text-white backdrop-blur-sm"
            style={{ left: hoverX }}
          >
            {formatClipTime(hoverTime - start)}
          </div>
        )}
      </div>
      <span className="w-10 text-xs nums text-white/80">{formatClipTime(duration)}</span>
    </div>
  );
}
