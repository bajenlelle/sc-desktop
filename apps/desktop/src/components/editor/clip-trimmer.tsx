import * as React from "react";
import { animate, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { formatClipTime } from "@scoutable/shared/lib/clip-timing";
import { clamp, rubberband } from "@scoutable/shared/lib/motion-math";
import {
  clampTrimEdge,
  describeTrim,
  formatSeconds,
  slideWindow,
  trimEdgeLimits,
  trimRange,
  type TrimLimits,
} from "@scoutable/shared/lib/trim-math";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { togglePlayerMuted } from "@/lib/player-sound";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFrameSeek } from "./use-frame-seek";

/** QuickTime's trim yellow (systemYellow on dark): the bar always sits over footage. */
const TRIM_YELLOW = "#ffd60a";

export interface TrimWindow {
  start: number;
  end: number;
}

type Edge = "in" | "out";

/** Grab strips along the frame's top and bottom edges: they move the whole clip. */
const GRIP_CLASS = "absolute z-[5] h-2.5 touch-none outline-none";

function knownDuration(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
}

/**
 * QuickTime's trim bar, shown over the player in place of the transport.
 * The track spans the footage around the clip, with the clip framed in
 * yellow and the play marked. A handle drags 1:1 from where it was grabbed,
 * shows the frame under it, and resists past its limits (the ends of the
 * video, a clip of one second). Either end may pass the play: play-by-play
 * times can be off, and the clip belongs on the footage of the play.
 * Dragging the frame by its top or bottom edge moves the whole clip, its
 * length unchanged. The track starts at the clip with a margin either side
 * and widens after each drag that reaches its end. Space plays the trimmed
 * clip once; I and O set an end at the playhead; ←/→ step the playhead;
 * Return keeps the trim and Esc puts it back. Rendered inside PlayerStage's
 * bar material (`trimBar`).
 */
export function ClipTrimmer({
  video,
  eventTime,
  initial,
  onCancel,
  onDone,
}: {
  video: HTMLVideoElement;
  /** When the play happens, in seconds into the video. */
  eventTime: number;
  initial: TrimWindow;
  onCancel: () => void;
  onDone: (window: TrimWindow) => void;
}) {
  const reduced = useReducedMotionSafe();
  const [win, setWin] = React.useState<TrimWindow>(initial);
  const winRef = React.useRef(win);
  winRef.current = win;
  const [duration, setDuration] = React.useState(() => knownDuration(video));
  const [range, setRange] = React.useState(() => trimRange({ ...initial, duration: knownDuration(video) }));
  const [dragging, setDragging] = React.useState<Edge | "clip" | null>(null);
  const [width, setWidth] = React.useState(0);
  const [playing, setPlaying] = React.useState(!video.paused);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const grabRef = React.useRef<{ edge: Edge; offset: number } | null>(null);
  /** A frame drag: where the pointer went down, and the clip as it was. */
  const slideRef = React.useRef<{ x: number; origin: TrimWindow } | null>(null);
  const scrubbingRef = React.useRef(false);
  const releasedRef = React.useRef(false);
  const laidOutRef = React.useRef(false);
  /** Space plays the trim once: playback stops here. */
  const playUntilRef = React.useRef<number | null>(null);
  const inX = useMotionValue(0);
  const outX = useMotionValue(0);
  const playheadX = useMotionValue(0);
  const clipWidth = useTransform<number, number>([inX, outX], ([a, b]) => Math.max(0, b - a));
  const frameSeek = useFrameSeek(video, (t) => {
    video.currentTime = t;
  });

  const span = Math.max(0.001, range.to - range.from);
  const xOf = React.useCallback((t: number) => ((t - range.from) / span) * width, [range.from, span, width]);
  const tOf = React.useCallback((x: number) => range.from + (x / Math.max(1, width)) * span, [range.from, span, width]);
  const geometry = React.useRef({ xOf, width });
  geometry.current = { xOf, width };

  const limitsFor = React.useCallback(
    (w: TrimWindow): TrimLimits => ({ start: w.start, end: w.end, duration }),
    [duration],
  );

  // The track's width, as laid out.
  React.useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The video's length can arrive after the trim opened.
  React.useEffect(() => {
    const onDuration = () => setDuration(knownDuration(video));
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("loadedmetadata", onDuration);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("loadedmetadata", onDuration);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [video]);

  // Between drags the track keeps a margin around the clip: an end dragged
  // up to the edge gets more footage to go on with once it lets go.
  React.useEffect(() => {
    if (dragging) return;
    const next = trimRange({ ...win, duration });
    const roomy = win.start - range.from >= 2 || range.from === 0;
    const roomyEnd = range.to - win.end >= 2 || (duration !== null && range.to >= duration);
    if (!roomy || !roomyEnd || (duration !== null && range.to > duration)) setRange(next);
  }, [win, duration, dragging, range.from, range.to]);

  // Handles follow the trim between drags: placed on first layout, sprung
  // after that (with a little settle when a drag lets go past a limit).
  React.useLayoutEffect(() => {
    if (dragging || width === 0) return;
    const targets: Array<[MotionValue<number>, number]> = [
      [inX, xOf(win.start)],
      [outX, xOf(win.end)],
    ];
    if (!laidOutRef.current || reduced) {
      laidOutRef.current = true;
      for (const [mv, x] of targets) mv.set(x);
      return;
    }
    const transition = releasedRef.current ? springs.settle : springs.standard;
    releasedRef.current = false;
    const controls = targets.map(([mv, x]) => animate(mv, x, transition));
    return () => controls.forEach((c) => c.stop());
  }, [win.start, win.end, xOf, width, dragging, inX, outX, reduced]);

  // The playhead follows the footage at the display rate; a Space play
  // stops at the out point.
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { xOf: x, width: w } = geometry.current;
      playheadX.set(clamp(x(video.currentTime), 0, w));
      const until = playUntilRef.current;
      if (until !== null && !video.paused && video.currentTime >= until - 0.02) {
        video.pause();
        playUntilRef.current = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, playheadX]);

  function stopPlayback() {
    playUntilRef.current = null;
    if (!video.paused) video.pause();
  }

  function togglePlayTrim() {
    if (!video.paused) {
      stopPlayback();
      return;
    }
    const { start, end } = winRef.current;
    const t = video.currentTime;
    // From the playhead when it is inside the trim, else from the in point.
    const from = t < start || t >= end - 0.05 ? start : t;
    playUntilRef.current = end;
    if (Math.abs(t - from) > 0.01) video.currentTime = from;
    video.play().catch(() => {});
  }

  function setEdge(edge: Edge, t: number) {
    const w = winRef.current;
    const value = clampTrimEdge(edge, t, limitsFor(w));
    setWin(edge === "in" ? { ...w, start: value } : { ...w, end: value });
    return value;
  }

  function cancel() {
    stopPlayback();
    onCancel();
  }

  function done() {
    stopPlayback();
    onDone(winRef.current);
  }

  useKeyScope("trim", true);
  useHotkeys("trim", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A focused button answers Return and Space itself.
    const onButton = e.target instanceof Element && !!e.target.closest("button");
    switch (e.code) {
      case "Space":
        if (onButton) return;
        e.preventDefault();
        togglePlayTrim();
        return;
      case "KeyM":
        if (e.shiftKey) return;
        e.preventDefault();
        togglePlayerMuted({ announce: true });
        return;
      case "Enter":
      case "NumpadEnter":
        if (onButton) return;
        e.preventDefault();
        done();
        return;
      case "Escape":
        e.preventDefault();
        cancel();
        return;
      case "KeyI":
      case "KeyO": {
        e.preventDefault();
        stopPlayback();
        setEdge(e.code === "KeyI" ? "in" : "out", video.currentTime);
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        stopPlayback();
        const step = (e.code === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
        video.currentTime = clamp(video.currentTime + step, range.from, range.to);
        return;
      }
      default:
        return;
    }
  });

  // --- Handles ------------------------------------------------------------

  function onHandlePointerDown(edge: Edge, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const track = trackRef.current?.getBoundingClientRect();
    if (!track) return;
    // Keep the grab offset: the handle never jumps to the pointer.
    const at = (edge === "in" ? inX : outX).get();
    grabRef.current = { edge, offset: e.clientX - track.left - at };
    stopPlayback();
    setDragging(edge);
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = grabRef.current;
    const track = trackRef.current?.getBoundingClientRect();
    if (!g || !track) return;
    const raw = e.clientX - track.left - g.offset;
    const w = winRef.current;
    const limits = limitsFor(w);
    const { min, max } = trimEdgeLimits(g.edge, limits);
    // 1:1 inside the limits, resisting past them.
    const lo = Math.max(0, xOf(min));
    const hi = Math.min(track.width, xOf(max));
    const held = clamp(raw, lo, hi);
    (g.edge === "in" ? inX : outX).set(held + rubberband(raw - held, track.width));
    const value = clampTrimEdge(g.edge, clamp(tOf(raw), range.from, range.to), limits);
    const current = g.edge === "in" ? w.start : w.end;
    if (value !== current) {
      setWin(g.edge === "in" ? { ...w, start: value } : { ...w, end: value });
      frameSeek.schedule(value);
    }
  }

  function onHandlePointerUp() {
    if (!grabRef.current) return;
    grabRef.current = null;
    frameSeek.settle();
    releasedRef.current = true;
    setDragging(null);
  }

  function onHandleKeyDown(edge: Edge, e: React.KeyboardEvent<HTMLDivElement>) {
    const w = winRef.current;
    const current = edge === "in" ? w.start : w.end;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = current - (e.shiftKey ? 1 : 0.1);
    else if (e.key === "ArrowRight") next = current + (e.shiftKey ? 1 : 0.1);
    else if (e.key === "Home") next = -Infinity;
    else if (e.key === "End") next = Infinity;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    stopPlayback();
    const value = setEdge(edge, next);
    video.currentTime = value;
  }

  // --- The frame: its top or bottom edge moves the whole clip -------------

  function onFramePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    slideRef.current = { x: e.clientX, origin: winRef.current };
    stopPlayback();
    setDragging("clip");
  }

  function onFramePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = slideRef.current;
    if (!s) return;
    const { origin } = s;
    const dx = e.clientX - s.x;
    // 1:1 while the clip stays on the track, resisting past its ends.
    const held = clamp(dx, Math.min(0, -xOf(origin.start)), Math.max(0, width - xOf(origin.end)));
    const shown = held + rubberband(dx - held, width);
    inX.set(xOf(origin.start) + shown);
    outX.set(xOf(origin.end) + shown);
    const next = slideWindow(origin, (held / Math.max(1, width)) * span, duration);
    if (next.start !== winRef.current.start) {
      setWin(next);
      frameSeek.schedule(next.start);
    }
  }

  function onFramePointerUp() {
    if (!slideRef.current) return;
    slideRef.current = null;
    frameSeek.settle();
    releasedRef.current = true;
    setDragging(null);
  }

  function onFrameKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    stopPlayback();
    const next = slideWindow(winRef.current, (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1), duration);
    setWin(next);
    video.currentTime = next.start;
  }

  const frameGrip = {
    onPointerDown: onFramePointerDown,
    onPointerMove: onFramePointerMove,
    onPointerUp: onFramePointerUp,
    onPointerCancel: onFramePointerUp,
    onLostPointerCapture: onFramePointerUp,
  };

  // --- The track: press or drag to move the playhead ----------------------

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    stopPlayback();
    const track = e.currentTarget.getBoundingClientRect();
    frameSeek.schedule(clamp(tOf(e.clientX - track.left), range.from, range.to));
  }

  function onTrackPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbingRef.current) return;
    const track = e.currentTarget.getBoundingClientRect();
    frameSeek.schedule(clamp(tOf(e.clientX - track.left), range.from, range.to));
  }

  function onTrackPointerUp() {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    frameSeek.settle();
  }

  const limitsNow = limitsFor(win);
  const inLimits = trimEdgeLimits("in", limitsNow);
  const outLimits = trimEdgeLimits("out", limitsNow);
  const length = win.end - win.start;
  const playOnTrack = eventTime >= range.from && eventTime <= range.to;

  function handle(edge: Edge) {
    const x = edge === "in" ? inX : outX;
    const value = edge === "in" ? win.start : win.end;
    const lim = edge === "in" ? inLimits : outLimits;
    return (
      <motion.div
        role="slider"
        tabIndex={0}
        aria-label={edge === "in" ? "Start of the clip" : "End of the clip"}
        aria-valuemin={Math.round(lim.min * 10) / 10}
        aria-valuemax={Number.isFinite(lim.max) ? Math.round(lim.max * 10) / 10 : undefined}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={formatClipTime(value)}
        onPointerDown={(e) => onHandlePointerDown(edge, e)}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onLostPointerCapture={onHandlePointerUp}
        onKeyDown={(e) => onHandleKeyDown(edge, e)}
        style={{ x, backgroundColor: TRIM_YELLOW }}
        className={cn(
          // A wider invisible hit area than the 12 px grip.
          "absolute inset-y-0 left-0 z-10 flex w-3 cursor-ew-resize items-center justify-center text-black/70 outline-none before:absolute before:-inset-x-1.5 before:inset-y-0 before:content-[''] focus-visible:ring-2 focus-visible:ring-white",
          edge === "in" ? "-ml-3 rounded-l-md" : "rounded-r-md",
        )}
      >
        {edge === "in" ? <ChevronLeft className="size-3" strokeWidth={3} /> : <ChevronRight className="size-3" strokeWidth={3} />}
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play the trimmed clip"}
              onClick={togglePlayTrim}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/85 outline-none transition-[background-color,transform] duration-100 hover:bg-white/10 hover:text-white active:scale-90 active:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 [&_svg]:size-[18px]"
            >
              {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="flex items-center gap-1.5">
            {playing ? "Pause" : "Play the trimmed clip"}
            <Kbd className="h-4 min-w-4 border-white/20 bg-white/10 text-footnote text-white/80">Space</Kbd>
          </TooltipContent>
        </Tooltip>

        <div
          ref={trackRef}
          className="relative h-10 flex-1 cursor-default touch-none select-none"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
        >
          {/* The footage around the clip, then the clip itself. */}
          <div aria-hidden className="absolute inset-x-0 inset-y-1.5 rounded-md bg-white/12" />
          <motion.div aria-hidden className="absolute inset-y-1.5 bg-white/30" style={{ left: inX, width: clipWidth }} />
          {/* The play, where the play-by-play puts it: inside the clip or
              not. Off the track, a chevron at that end points to it. */}
          {playOnTrack ? (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-primary",
                !dragging && "transition-[left] duration-300",
              )}
              style={{ left: xOf(eventTime) }}
            />
          ) : (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 flex items-center text-primary",
                eventTime < range.from ? "left-0.5" : "right-0.5",
              )}
            >
              {eventTime < range.from ? (
                <ChevronLeft className="size-3.5" strokeWidth={3} />
              ) : (
                <ChevronRight className="size-3.5" strokeWidth={3} />
              )}
            </div>
          )}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-y-0.5 left-0 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_2px_rgb(0_0_0/0.6)]"
            style={{ x: playheadX }}
          />
          {/* The yellow frame between the handles. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-y-[3px]"
            style={{ left: inX, width: clipWidth, borderColor: TRIM_YELLOW }}
          />
          <motion.div
            role="slider"
            tabIndex={0}
            aria-label="Clip position"
            aria-valuemin={0}
            aria-valuemax={duration !== null ? Math.round(Math.max(0, duration - length) * 10) / 10 : undefined}
            aria-valuenow={Math.round(win.start * 10) / 10}
            aria-valuetext={`Starts at ${formatClipTime(win.start)}`}
            {...frameGrip}
            onKeyDown={onFrameKeyDown}
            style={{ left: inX, width: clipWidth }}
            className={cn(
              GRIP_CLASS,
              "top-0 rounded-t-sm focus-visible:ring-2 focus-visible:ring-white",
              dragging === "clip" ? "cursor-grabbing" : "cursor-grab",
            )}
          />
          <motion.div
            aria-hidden
            {...frameGrip}
            style={{ left: inX, width: clipWidth }}
            className={cn(GRIP_CLASS, "bottom-0", dragging === "clip" ? "cursor-grabbing" : "cursor-grab")}
          />
          {handle("in")}
          {handle("out")}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-1.5">
        <p className="min-w-0 flex-1 truncate text-xs nums text-white/75" aria-live="polite">
          <span className="text-white">{formatSeconds(length)}</span>
          <span aria-hidden> · </span>
          {describeTrim({ eventTime, start: win.start, end: win.end })}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={cancel}>
                Cancel
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="flex items-center gap-1.5">
              Put the clip back
              <Kbd className="h-4 min-w-4 border-white/20 bg-white/10 text-footnote text-white/80">esc</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={done}>
                Done
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="flex items-center gap-1.5">
              Keep the trim
              <Kbd className="h-4 min-w-4 border-white/20 bg-white/10 text-footnote text-white/80">↩</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
