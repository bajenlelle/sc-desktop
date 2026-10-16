"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { clamp, rubberband } from "@scoutable/shared/lib/motion-math";
import { formatClipTime } from "@scoutable/shared/lib/clip-timing";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFrameSeek } from "./use-frame-seek";

/** How close to the thumb a press counts as grabbing it, by pointer. */
const THUMB_HIT = { mouse: 10, touch: 24 } as const;

/**
 * The playing clip's timeline, built like NSSlider: pressing the thumb keeps
 * the grab offset, pressing the track jumps, the thumb follows the pointer
 * 1:1 (one seek per frame, never while the decoder is still seeking),
 * rubber-bands past the ends and springs back on release. Scrubbing pauses
 * the video and resumes it on release if it was playing: finding the frame
 * is the task. Keys on the focused slider nudge by a second (Shift: ten) or
 * a frame (`,` and `.`). The time readouts are painted each frame, straight
 * from the element.
 */
export function ClipScrubber({
  video,
  duration: total,
  onSeek,
  frameSeconds = 1 / 25,
  className,
}: {
  video: HTMLVideoElement;
  /** The clip's length: each clip is its own file, so the track spans it. */
  duration: number;
  onSeek: (t: number) => void;
  frameSeconds?: number;
  className?: string;
}) {
  const duration = Math.max(0.001, total);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const thumbX = useMotionValue(0);
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const scrubRef = useRef<{ grabOffset: number; wasPlaying: boolean } | null>(null);
  const frameSeek = useFrameSeek(video, onSeek);

  const paint = useCallback(
    (time: number) => {
      const frac = clamp(time / duration, 0, 1);
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${frac})`;
      const label = formatClipTime(clamp(time, 0, duration));
      if (elapsedRef.current) elapsedRef.current.textContent = label;
      const track = trackRef.current;
      if (track) {
        track.setAttribute("aria-valuenow", String(Math.round(clamp(time, 0, duration) * 10) / 10));
        track.setAttribute("aria-valuetext", label);
      }
      return frac;
    },
    [duration],
  );

  // Follow playback at the display rate (timeupdate fires a few times a
  // second); while scrubbing the pointer drives the thumb instead.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (!scrubRef.current) thumbX.set(paint(video.currentTime) * (trackRef.current?.clientWidth ?? 0));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, paint, thumbX]);

  function timeAtPointer(clientX: number, grabOffset = 0) {
    const track = trackRef.current;
    if (!track) return { time: 0, raw: 0, width: 0 };
    const rect = track.getBoundingClientRect();
    const raw = clientX - rect.left - grabOffset;
    return { time: clamp(raw / rect.width, 0, 1) * duration, raw, width: rect.width };
  }

  function moveThumb(clientX: number) {
    const s = scrubRef.current;
    if (!s) return;
    const { time, raw, width } = timeAtPointer(clientX, s.grabOffset);
    // Past either end the thumb resists instead of stopping dead.
    const over = raw < 0 ? raw : raw > width ? raw - width : 0;
    thumbX.set(clamp(raw, 0, width) + rubberband(over, width));
    paint(time);
    frameSeek.schedule(time);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const thumbAt = thumbX.get();
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const hit = e.pointerType === "mouse" ? THUMB_HIT.mouse : THUMB_HIT.touch;
    scrubRef.current = {
      grabOffset: Math.abs(localX - thumbAt) <= hit ? localX - thumbAt : 0,
      wasPlaying: !video.paused,
    };
    if (!video.paused) video.pause();
    setPressed(true);
    moveThumb(e.clientX);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (scrubRef.current) {
      moveThumb(e.clientX);
      return;
    }
    // The time under the pointer, for a mouse hovering the track.
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({ x: clamp(e.clientX - rect.left, 0, rect.width), time: timeAtPointer(e.clientX).time });
  }

  function endScrub() {
    const s = scrubRef.current;
    if (!s) return;
    frameSeek.settle();
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
    onSeek(clamp(video.currentTime + delta, 0, duration));
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span ref={elapsedRef} className="w-10 shrink-0 text-right text-xs nums text-white/80">
        {formatClipTime(0)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Clip position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        // Constant here so React sets them once; paint() keeps them current.
        aria-valuenow={0}
        aria-valuetext={formatClipTime(0)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="group/track relative h-6 flex-1 cursor-default touch-none select-none outline-none pointer-coarse:h-9 focus-visible:[&>div:first-child]:ring-2 focus-visible:[&>div:first-child]:ring-white/60"
      >
        {/* Track: grows on hover like a QuickTime scrubber. */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/track:h-2">
          <div ref={fillRef} className="h-full w-full origin-left rounded-full bg-white/90" style={{ transform: "scaleX(0)" }} />
        </div>
        <motion.div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.5)] pointer-coarse:size-4"
          style={{ x: thumbX }}
          animate={{ scale: pressed ? 1.4 : 1 }}
          transition={springs.snappy}
        />
        {hover && !pressed && (
          <div
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] nums text-white backdrop-blur-sm"
            style={{ left: hover.x }}
          >
            {formatClipTime(hover.time)}
          </div>
        )}
      </div>
      <span className="w-10 shrink-0 text-xs nums text-white/80">{formatClipTime(duration)}</span>
    </div>
  );
}

/**
 * The playing clip's timeline for a viewer who may not drag it: a clip
 * counts as watched near its end, so a player who could drag there would
 * skip it. The scrubber's times around a thinner line with nothing to grab,
 * painted each frame from the element.
 */
export function ClipProgress({
  video,
  duration: total,
  className,
}: {
  video: HTMLVideoElement;
  duration: number;
  className?: string;
}) {
  const duration = Math.max(0.001, total);
  const barRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let shown = "";
    const tick = () => {
      const time = clamp(video.currentTime, 0, duration);
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${time / duration})`;
      const label = formatClipTime(time);
      if (label !== shown) {
        shown = label;
        if (elapsedRef.current) elapsedRef.current.textContent = label;
        barRef.current?.setAttribute("aria-valuenow", String(Math.round(time * 10) / 10));
        barRef.current?.setAttribute("aria-valuetext", label);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, duration]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span ref={elapsedRef} className="w-10 shrink-0 text-right text-xs nums text-white/80">
        {formatClipTime(0)}
      </span>
      <div
        ref={barRef}
        role="progressbar"
        aria-label="Clip position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        // Constant here so React sets them once; the frame loop keeps them current.
        aria-valuenow={0}
        aria-valuetext={formatClipTime(0)}
        className="relative h-6 flex-1"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
          <div ref={fillRef} className="h-full w-full origin-left rounded-full bg-white/90" style={{ transform: "scaleX(0)" }} />
        </div>
      </div>
      <span className="w-10 shrink-0 text-xs nums text-white/80">{formatClipTime(duration)}</span>
    </div>
  );
}
