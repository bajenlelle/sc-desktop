import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { scoreAfter, type GameFlow } from "@scoutable/shared/lib/game-flow";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { describeShiftSeconds } from "@scoutable/shared/lib/sync-check";
import { useFrameSeek } from "@/components/editor/use-frame-seek";
import type { PlayByPlayEvent } from "@/types/match";
import { GAME_TRACK_HEIGHT } from "./game-timeline-strip";

/** How much of the video the strip shows. */
const WINDOW_SECONDS = 90;
/** The window moves on by this much when the playhead comes near an end of it. */
const PAGE_SECONDS = 30;
const EDGE_SECONDS = 8;
/** The line the plays sit on. */
const BASE_Y = 66;

const mmss = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

/** The video's position as state, for a strip that is drawn from it: every frame while it plays, on each seek while it doesn't. */
function useVideoClock(video: HTMLVideoElement): number {
  const [t, setT] = useState(video.currentTime);
  useEffect(() => {
    let raf = 0;
    const read = () => setT(video.currentTime);
    const tick = () => {
      read();
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!video.paused && !video.ended) {
        if (!raf) raf = requestAnimationFrame(tick);
        return;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      read();
    };
    sync();
    const events = ["play", "playing", "pause", "ended", "seeking", "seeked", "timeupdate"] as const;
    for (const ev of events) video.addEventListener(ev, sync);
    return () => {
      for (const ev of events) video.removeEventListener(ev, sync);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [video]);
  return t;
}

/**
 * The timeline's place while a play is being found: a minute and a half of
 * the video around the playhead, close enough to land on a moment. The play
 * rides on the playhead, and the plays after it ride along by as much, each
 * basket with its score: when the scores line up with the baskets in the
 * footage, the place is right. Where the play was is left as a ring, with
 * how far it has moved. A press takes the playhead to the pointer and a drag
 * moves it 1:1, as on the timeline it stands in for.
 */
export function SyncFindStrip({
  video,
  event,
  mapped,
  frozen,
  plays,
  flow,
  duration,
  onSeek,
  hint,
}: {
  video: HTMLVideoElement;
  /** The play being found. */
  event: PlayByPlayEvent;
  /** Where the sync has it. */
  mapped: number;
  /** The place the coach set, while it is being confirmed: the strip stands still on it. */
  frozen: number | null;
  /** The game's plays, where the sync has them. */
  plays: readonly TimedPlay[];
  flow: GameFlow;
  duration: number | null;
  onSeek: (t: number) => void;
  /** What to do, under the track. */
  hint: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const live = useVideoClock(video);
  const t = frozen ?? live;
  const [start, setStart] = useState(() => mapped - WINDOW_SECONDS * 0.55);
  const dragging = useRef(false);
  const frameSeek = useFrameSeek(video, onSeek);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The window follows the playhead a page at a time, never under a held pointer.
  useEffect(() => {
    if (dragging.current) return;
    setStart((a) => {
      let next = a;
      while (t < next + EDGE_SECONDS) next -= PAGE_SECONDS;
      while (t > next + WINDOW_SECONDS - EDGE_SECONDS) next += PAGE_SECONDS;
      return next;
    });
  }, [t]);

  const end = start + WINDOW_SECONDS;
  const xOf = (seconds: number) => ((seconds - start) / WINDOW_SECONDS) * width;
  const delta = t - mapped;
  const max = duration ?? Infinity;

  // The play's neighbours in its quarter: the ones after it move with it, the ones before it stay.
  const near = useMemo(
    () =>
      plays
        .filter((p) => p.event.period === event.period && p.event.eventId !== event.eventId && !p.own && Math.abs(p.time - mapped) < 600)
        .map((p) => {
          const made = (p.event.type === "2pt" || p.event.type === "3pt" || p.event.type === "freethrow") && p.event.isSuccessful === 1;
          const score = made ? scoreAfter(flow, p.event.eventId) : null;
          return { key: p.key, time: p.time, rides: p.time >= mapped, score: score ? `${score.home}–${score.away}` : null };
        }),
    [plays, event, mapped, flow],
  );
  const ownScore = useMemo(() => {
    const made = (event.type === "2pt" || event.type === "3pt" || event.type === "freethrow") && event.isSuccessful === 1;
    const s = made ? scoreAfter(flow, event.eventId) : null;
    return s ? `${s.home}–${s.away}` : null;
  }, [event, flow]);

  const toPointer = (clientX: number) => {
    const left = trackRef.current?.getBoundingClientRect().left ?? 0;
    const x = clamp(clientX - left, 0, width);
    frameSeek.schedule(clamp(start + (x / Math.max(1, width)) * WINDOW_SECONDS, 0, max));
  };

  const ticks: number[] = [];
  for (let s = Math.ceil(start / 10) * 10; s <= end; s += 10) if (s >= 0 && s <= max) ticks.push(s);
  const playheadX = xOf(t);
  const ghostX = xOf(mapped);
  const moved = Math.abs(delta) >= 0.75;
  // A score is printed only where it has room: not on top of the one before it, nor on the playhead's own.
  let lastLabelX = -Infinity;

  return (
    <section aria-label="Find the play" className="relative z-10 shrink-0 pb-3 select-none">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Position near the play"
        aria-valuemin={Math.round(Math.max(0, start))}
        aria-valuemax={Math.round(end)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${mmss(t)} in the video${moved ? `, ${describeShiftSeconds(delta)}` : ""}`}
        aria-disabled={frozen !== null || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 || frozen !== null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          if (!video.paused) video.pause();
          toPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) toPointer(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
          frameSeek.settle();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          frameSeek.settle();
        }}
        className="relative cursor-default touch-none overflow-hidden rounded-md bg-fill-1 outline-none focus-visible:ring-2 focus-visible:ring-selection"
        style={{ height: GAME_TRACK_HEIGHT }}
      >
        {width > 0 && (
          <svg width={width} height={GAME_TRACK_HEIGHT} className="absolute inset-0 block text-foreground" aria-hidden>
            <line x1={0} x2={width} y1={BASE_Y} y2={BASE_Y} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
            {ticks.map((s) => (
              <g key={s}>
                <line x1={xOf(s)} x2={xOf(s)} y1={BASE_Y} y2={BASE_Y + (s % 30 === 0 ? 7 : 4)} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
                {s % 30 === 0 && (
                  <text x={xOf(s)} y={BASE_Y + 22} textAnchor="middle" className="text-caption nums" style={{ fill: "var(--muted-foreground)" }}>
                    {mmss(s)}
                  </text>
                )}
              </g>
            ))}

            {/* The plays before this one stay where they are. */}
            {near
              .filter((p) => !p.rides && p.time >= start && p.time <= end)
              .map((p) => (
                <circle key={p.key} cx={xOf(p.time)} cy={BASE_Y} r="2.5" style={{ fill: "var(--muted-foreground)" }} fillOpacity={0.45} />
              ))}

            {/* The plays after it ride along; each basket carries its score. */}
            {near
              .filter((p) => p.rides)
              .map((p) => {
                const x = xOf(p.time + delta);
                if (x < -20 || x > width + 20) return null;
                const room = p.score !== null && x - lastLabelX > 44 && Math.abs(x - playheadX) > 40;
                if (room) lastLabelX = x;
                return (
                  <g key={p.key}>
                    <circle cx={x} cy={BASE_Y} r={p.score ? 3.5 : 2.5} fill="currentColor" fillOpacity={p.score ? 0.85 : 0.5} />
                    {room && (
                      <text x={x} y={BASE_Y - 10} textAnchor="middle" className="text-caption nums" style={{ fill: "var(--muted-foreground)" }}>
                        {p.score}
                      </text>
                    )}
                  </g>
                );
              })}

            {/* Where the play was, and how far it has come. */}
            {moved && (
              <g data-find="moved">
                <circle cx={ghostX} cy={BASE_Y} r="5" fill="none" strokeWidth="1.5" strokeDasharray="2.5 2.5" style={{ stroke: "var(--muted-foreground)" }} />
                <path
                  d={`M${ghostX} ${BASE_Y - 8} V22 H${playheadX}`}
                  fill="none"
                  strokeWidth="1"
                  strokeDasharray="2.5 2.5"
                  style={{ stroke: "var(--muted-foreground)" }}
                />
                <text
                  x={clamp((ghostX + playheadX) / 2, 44, Math.max(44, width - 44))}
                  y={16}
                  textAnchor="middle"
                  className="text-footnote font-semibold nums"
                  style={{ fill: "var(--foreground)" }}
                >
                  {describeShiftSeconds(delta)}
                </text>
              </g>
            )}

            {/* The playhead, with the play on it. */}
            <line x1={playheadX} x2={playheadX} y1={moved ? 22 : 8} y2={GAME_TRACK_HEIGHT - 8} strokeWidth="2" strokeLinecap="round" stroke="currentColor" />
            <circle cx={playheadX} cy={BASE_Y} r="6" fill="currentColor" style={{ stroke: "var(--background)" }} strokeWidth="2" />
            {ownScore && (
              <text x={playheadX + 11} y={BASE_Y - 12} className="text-footnote font-semibold nums" style={{ fill: "var(--foreground)" }}>
                {ownScore}
              </text>
            )}
          </svg>
        )}
      </div>
      <div className="mt-1 flex h-7 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center text-subheadline text-muted-foreground">{hint}</div>
        <span className="ml-auto shrink-0 text-subheadline text-muted-foreground nums">{mmss(t)} in the video</span>
      </div>
    </section>
  );
}
