import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describePlay, eventHue, formatGameClock, periodLabel, type EventHue } from "@scoutable/shared/lib/events";
import { flowChart, scoreAfter, type CourtStint, type GameFlow, type GameMoment } from "@scoutable/shared/lib/game-flow";
import { gameScale, type GameScale, type GameTimeline, type ScaleSegment, type TimedPlay } from "@scoutable/shared/lib/game-timeline";
import type { GameMarks } from "@scoutable/shared/types/game-marks";
import { useFrameSeek } from "@/components/editor/use-frame-seek";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { cn } from "@/lib/utils";
import { teamTints, type TeamTints } from "./team-tints";

/** The strip's lanes, top to bottom, in pixels. */
const Y = {
  periods: 0,
  periodsH: 18,
  chart: 22,
  chartH: 64,
  stint: 89,
  stintH: 3,
  homeTicks: 95,
  awayTicks: 106,
  tickH: 9,
  height: 116,
} as const;

/** How near (px) the pointer must be to a play for a click to mean that play. */
const SNAP_PX = 4;
/** Movement (px) that turns a press into a scrub. */
const DRAG_PX = 4;
/** At the whole game's width only the largest runs are drawn. */
const RUNS_SHOWN = 6;

/** Event colours for the ticks, by the family an event belongs to (the rows' colours, as SVG fills). */
const TICK_FILL: Record<EventHue, string> = {
  make: "fill-emerald-500",
  miss: "fill-red-500",
  rebound: "fill-sky-500",
  assist: "fill-cyan-500",
  steal: "fill-violet-500",
  block: "fill-violet-600",
  turnover: "fill-amber-500",
  foul: "fill-orange-500",
  neutral: "fill-slate-400",
};

const SHOTS = new Set(["2pt", "3pt", "freethrow"]);

function formatVideoTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** What a folded stretch of footage is, in words. */
function notchName(s: ScaleSegment): string {
  if (s.kind === "pre") return "Before tip-off";
  if (s.kind === "post") return "After the final whistle";
  if (s.period === 2 && s.next === 3) return "Half-time";
  return s.next ? `Break before ${periodLabel(s.next)}` : "Break";
}

interface Teams {
  home: { name: string; color: string };
  away: { name: string; color: string };
}

/**
 * Everything on the strip that doesn't move with playback, drawn once per
 * game, width, zoom and filter: the period bands with their scores, the
 * score graph, runs, timeouts, the clutch stretch, a tick per play and a
 * chosen player's stints on the floor.
 */
const StripDrawing = memo(function StripDrawing({
  scale,
  timeline,
  flow,
  marks,
  teams,
  tints,
  dimmed,
  inTarget,
  stints,
  clutch,
  zoomed,
  patternId,
}: {
  scale: GameScale;
  timeline: GameTimeline;
  flow: GameFlow;
  marks: GameMarks | null;
  teams: Teams;
  tints: TeamTints;
  /** Plays the filter hides, by key; null when no filter is on. */
  dimmed: ReadonlySet<string> | null;
  inTarget: ReadonlySet<string>;
  stints: readonly CourtStint[] | null;
  /** The clutch stretch on the axis, when the game has one. */
  clutch: { from: number; to: number } | null;
  zoomed: boolean;
  patternId: string;
}) {
  const width = scale.width;
  const playByEvent = useMemo(() => new Map(timeline.plays.map((p) => [p.event.eventId, p])), [timeline]);
  const xOfEvent = (eventId: number) => {
    const p = playByEvent.get(eventId);
    return p ? scale.xOf(p.time) : null;
  };

  const chart = useMemo(() => {
    if (flow.source === "none") return null;
    // Only the baskets inside the strip are drawn. A zoomed stretch opens on
    // the difference it starts with and keeps the whole game's scale.
    const first = scale.segments[0]?.t0 ?? -Infinity;
    const last = scale.segments[scale.segments.length - 1]?.t1 ?? Infinity;
    const points: { x: number; diff: number }[] = [];
    let startDiff = 0;
    let largest = 0;
    for (const p of flow.points) {
      largest = Math.max(largest, Math.abs(p.diff));
      const play = playByEvent.get(p.eventId);
      if (!play) continue;
      if (zoomed && play.time < first) startDiff = p.diff;
      else if (!zoomed || play.time <= last) points.push({ x: scale.xOf(play.time), diff: p.diff });
    }
    points.sort((a, b) => a.x - b.x);
    return flowChart({ points, x0: 0, x1: width, height: Y.chartH, pad: 3, startDiff, minScale: Math.max(10, Math.ceil(largest / 5) * 5) });
  }, [flow, playByEvent, scale, width, zoomed]);

  const peak = flow.largestLead.home && flow.largestLead.away
    ? flow.largestLead.home.lead >= flow.largestLead.away.lead
      ? { side: 1 as const, ...flow.largestLead.home }
      : { side: 2 as const, ...flow.largestLead.away }
    : flow.largestLead.home
      ? { side: 1 as const, ...flow.largestLead.home }
      : flow.largestLead.away
        ? { side: 2 as const, ...flow.largestLead.away }
        : null;
  // Zoomed into another quarter, the peak isn't on the strip.
  const peakPlay = peak ? playByEvent.get(peak.eventId) : undefined;
  const peakShown =
    !!peakPlay && (!zoomed || (peakPlay.time >= (scale.segments[0]?.t0 ?? 0) && peakPlay.time <= (scale.segments[scale.segments.length - 1]?.t1 ?? 0)));
  const peakX = peak && peakShown ? xOfEvent(peak.eventId) : null;

  const runs = useMemo(() => {
    const list = zoomed ? flow.runs : [...flow.runs].sort((a, b) => b.points - a.points).slice(0, RUNS_SHOWN);
    return list;
  }, [flow, zoomed]);

  return (
    <svg width={width} height={Y.height} className="absolute inset-0 block text-foreground" aria-hidden>
      <defs>
        <pattern id={`${patternId}-notch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" strokeWidth="2" style={{ stroke: "var(--separator)" }} />
        </pattern>
        <pattern id={`${patternId}-away`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
          <line x1="0" y1="0" x2="0" y2="5" strokeWidth="1.5" stroke={tints.away} strokeOpacity={0.55} />
        </pattern>
      </defs>

      {/* Periods as bands; the footage around them folded into notches. */}
      {scale.segments.map((s, i) => {
        const w = s.x1 - s.x0;
        if (s.kind !== "period") {
          return w > 3 ? (
            <rect key={i} x={s.x0} y={0} width={w} height={Y.height} fill={`url(#${patternId}-notch)`} />
          ) : (
            <line key={i} x1={s.x0 + w / 2} x2={s.x0 + w / 2} y1={0} y2={Y.height} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
          );
        }
        const score = flow.periods.find((p) => p.period === s.period);
        const name = s.period !== undefined ? periodLabel(s.period) : "";
        const label = score && w >= 76 ? `${name}  ${score.home}–${score.away}` : w >= 24 ? name : "";
        return (
          <g key={i}>
            <rect x={s.x0} y={Y.periods} width={w} height={Y.periodsH} rx="4" style={{ fill: "var(--fill-1)" }} />
            {label && (
              <text
                x={s.x0 + w / 2}
                y={Y.periods + 12.5}
                textAnchor="middle"
                className="text-[11px] font-medium nums"
                style={{ fill: "var(--muted-foreground)", whiteSpace: "pre" }}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* Clutch time: a line under its stretch of the period band. */}
      {clutch && scale.xOf(clutch.to) - scale.xOf(clutch.from) > 2 && (
        <line
          x1={scale.xOf(clutch.from)}
          x2={scale.xOf(clutch.to)}
          y1={Y.periods + Y.periodsH + 1.5}
          y2={Y.periods + Y.periodsH + 1.5}
          strokeWidth="1.5"
          strokeDasharray="4 2"
          style={{ stroke: "var(--muted-foreground)" }}
        />
      )}

      {/* The score difference: home above the line, away below. */}
      <g transform={`translate(0 ${Y.chart})`}>
        {chart ? (
          <>
            {chart.maxAbs > 10 && (
              <>
                <line x1={0} x2={width} y1={chart.yOf(10)} y2={chart.yOf(10)} strokeWidth="1" style={{ stroke: "var(--separator)" }} />
                <line x1={0} x2={width} y1={chart.yOf(-10)} y2={chart.yOf(-10)} strokeWidth="1" style={{ stroke: "var(--separator)" }} />
              </>
            )}
            <path d={chart.home} fill={tints.home} fillOpacity={tints.homeOpacity} />
            <path d={chart.away} fill={tints.away} fillOpacity={tints.awayOpacity} />
            {tints.awayHatch && <path d={chart.away} fill={`url(#${patternId}-away)`} />}
            <line x1={0} x2={width} y1={chart.zeroY} y2={chart.zeroY} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
            <path d={chart.line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

            {/* Runs: a bar on the running side's edge. */}
            {runs.map((run) => {
              const from = xOfEvent(run.fromEventId);
              const to = xOfEvent(run.toEventId);
              if (from === null || to === null) return null;
              return (
                <rect
                  key={run.fromEventId}
                  x={from}
                  y={run.team === 1 ? 0 : Y.chartH - 3}
                  width={Math.max(3, to - from)}
                  height={3}
                  rx="1.5"
                  fill="currentColor"
                  fillOpacity={0.55}
                />
              );
            })}

            {/* The one number worth printing: the largest lead, at its peak. */}
            {peak && peakX !== null && (
              <text
                x={Math.min(Math.max(peakX, 14), width - 14)}
                // On the zero line's side of the peak, inside the area: the edges belong to the runs and the timeouts.
                y={peak.side === 1 ? chart.yOf(peak.lead) + 12 : chart.yOf(-peak.lead) - 5}
                textAnchor="middle"
                className="text-[10px] font-semibold nums"
                style={{ fill: "var(--foreground)" }}
              >
                +{peak.lead}
              </text>
            )}

            {/* Who is above and who is below: the graph's legend, on the graph. */}
            <g className="text-[10px] font-medium" style={{ fill: "var(--muted-foreground)" }}>
              <rect x={4} y={3} width={7} height={7} rx="1.5" fill={tints.home} fillOpacity={0.7} />
              <text x={15} y={10}>
                {teams.home.name}
              </text>
              <rect x={4} y={Y.chartH - 11} width={7} height={7} rx="1.5" fill={tints.away} fillOpacity={0.6} />
              <text x={15} y={Y.chartH - 4}>
                {teams.away.name}
              </text>
            </g>
          </>
        ) : (
          <text x={width / 2} y={Y.chartH / 2 + 4} textAnchor="middle" className="text-[12px]" style={{ fill: "var(--muted-foreground)" }}>
            This game has no score on record, so there is no score graph.
          </text>
        )}

        {/* Timeouts: a flag on the calling side's edge; the officials' on the line. */}
        {(marks?.timeouts ?? []).map((t) => {
          const time = timeline.timeOf(t.realWorldTime, t.period);
          if (time === null) return null;
          const x = scale.xOf(time);
          if (x <= 0 || x >= width) return null;
          const fill = { fill: "var(--muted-foreground)" };
          if (t.teamNumber === 1) return <path key={t.eventId} d={`M${x - 4} 0H${x + 4}L${x} 7Z`} style={fill} />;
          if (t.teamNumber === 2) return <path key={t.eventId} d={`M${x - 4} ${Y.chartH}H${x + 4}L${x} ${Y.chartH - 7}Z`} style={fill} />;
          return <circle key={t.eventId} cx={x} cy={Y.chartH / 2} r="2.5" fill="none" strokeWidth="1.5" style={{ stroke: "var(--muted-foreground)" }} />;
        })}
      </g>

      {/* A chosen player's stints on the floor. */}
      {(stints ?? []).map((s) => {
        const from = xOfEvent(s.fromEventId);
        const to = xOfEvent(s.toEventId);
        if (from === null || to === null) return null;
        return <rect key={s.fromEventId} x={from} y={Y.stint} width={Math.max(2, to - from)} height={Y.stintH} rx="1.5" fill="currentColor" fillOpacity={0.6} />;
      })}

      {/* One tick per play: home in the upper row, away in the lower, a make taller than a miss. */}
      {timeline.plays.map((p) => {
        if (p.reach !== "in") return null;
        const e = p.event;
        const side = e.eventTeam?.teamNumber ?? e.player?.teamNumber;
        if (side !== 1 && side !== 2) return null;
        const x = scale.xOf(p.time);
        if (zoomed && (x <= 0 || x >= width)) return null;
        const h = SHOTS.has(e.type) ? (e.isSuccessful ? Y.tickH : 5) : 6;
        const y = side === 1 ? Y.homeTicks + Y.tickH - h : Y.awayTicks;
        const hidden = dimmed?.has(p.key) ?? false;
        return (
          <g key={p.key} opacity={hidden ? 0.15 : 1}>
            <rect x={x - 0.75} y={y} width={1.5} height={h} className={TICK_FILL[eventHue(e)]} />
            {inTarget.has(p.key) && (
              <circle cx={x} cy={side === 1 ? Y.homeTicks - 2 : Y.awayTicks + Y.tickH + 2} r="2" style={{ fill: "var(--primary)" }} />
            )}
          </g>
        );
      })}
    </svg>
  );
});

interface Hover {
  x: number;
  /** The play a click here would mean; null in a break or with no play near. */
  play: TimedPlay | null;
  /** A play close enough that a click snaps to it. */
  snap: boolean;
  time: number;
  segment: ScaleSegment | null;
}

/**
 * The game on one strip: both the scrubber over the whole video and the
 * overview of how the game went. Quarters are bands (the breaks folded into
 * notches, so the strip is spent on basketball), the score difference runs
 * through them, timeouts and runs sit on its edges, every play is a tick,
 * and the playhead crosses all of it.
 *
 * A click snaps to the play under the pointer and plays it from its pre-roll,
 * exactly as its row would; with no play near, it goes to that second. A
 * drag scrubs 1:1 from where it was grabbed. Double-clicking a quarter gives
 * it the whole strip.
 */
export function GameTimelineStrip({
  timeline,
  flow,
  marks,
  moments,
  teams,
  video,
  order,
  filtered,
  inTarget,
  activeKey,
  stints,
  zoomPeriod,
  onZoom,
  onPlay,
  onSeek,
  hint,
  className,
}: {
  timeline: GameTimeline;
  flow: GameFlow;
  marks: GameMarks | null;
  moments: ReadonlyMap<number, ReadonlySet<GameMoment>>;
  teams: Teams;
  /** The footage; null when there is none to move through (the strip still reads, and a click selects a play). */
  video: HTMLVideoElement | null;
  /** The listed plays, by time: what a click can snap to. */
  order: readonly number[];
  filtered: boolean;
  inTarget: ReadonlySet<string>;
  activeKey: string | null;
  stints: readonly CourtStint[] | null;
  zoomPeriod: number | null;
  onZoom: (period: number | null) => void;
  onPlay: (play: TimedPlay) => void;
  onSeek: (t: number) => void;
  /** A first-visit line under the strip; gone after the first click. */
  hint: string | null;
  className?: string;
}) {
  const patternId = useId().replace(/:/g, "");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const pressRef = useRef<{ x: number; scrubbing: boolean; wasPlaying: boolean } | null>(null);
  const frameSeek = useFrameSeek(video, onSeek);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = useMemo(() => gameScale(timeline, Math.max(1, width), { zoomPeriod }), [timeline, width, zoomPeriod]);
  const tints = useMemo(() => teamTints(teams.home.color, teams.away.color), [teams.home.color, teams.away.color]);

  const dimmed = useMemo(() => {
    if (!filtered) return null;
    const shown = new Set(order.map((i) => timeline.plays[i].key));
    return new Set(timeline.plays.filter((p) => !shown.has(p.key)).map((p) => p.key));
  }, [filtered, order, timeline]);

  const clutch = useMemo(() => {
    let from = Infinity;
    let to = -Infinity;
    for (const p of timeline.plays) {
      if (!moments.get(p.event.eventId)?.has("clutch")) continue;
      from = Math.min(from, p.time);
      to = Math.max(to, p.time);
    }
    return Number.isFinite(from) ? { from, to } : null;
  }, [timeline, moments]);

  const activePlay = useMemo(() => (activeKey ? (timeline.plays.find((p) => p.key === activeKey) ?? null) : null), [timeline, activeKey]);

  // The playhead follows playback at the display rate, off React: a transform on one element.
  useEffect(() => {
    const el = playheadRef.current;
    if (!el) return;
    if (!video) {
      // No footage: the line marks the selected play.
      el.style.opacity = activePlay ? "1" : "0";
      if (activePlay) el.style.transform = `translateX(${scale.xOf(activePlay.time)}px)`;
      return;
    }
    el.style.opacity = "1";
    let raf = 0;
    const paint = () => {
      if (!pressRef.current?.scrubbing) el.style.transform = `translateX(${scale.xOf(video.currentTime)}px)`;
    };
    const tick = () => {
      paint();
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!video.paused && !video.ended) {
        if (!raf) raf = requestAnimationFrame(tick);
        return;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      paint();
    };
    sync();
    const events = ["play", "playing", "pause", "ended", "seeked", "timeupdate", "loadedmetadata", "emptied"] as const;
    for (const ev of events) video.addEventListener(ev, sync);
    return () => {
      for (const ev of events) video.removeEventListener(ev, sync);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [video, scale, activePlay]);

  /** The listed play nearest a pixel, and how far away it is. */
  const nearest = useCallback(
    (x: number): { play: TimedPlay; distance: number } | null => {
      if (order.length === 0) return null;
      const t = scale.tOf(x);
      let lo = 0;
      let hi = order.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (timeline.plays[order[mid]].time < t) lo = mid + 1;
        else hi = mid;
      }
      let best: { play: TimedPlay; distance: number } | null = null;
      for (const i of [lo - 1, lo]) {
        if (i < 0 || i >= order.length) continue;
        const play = timeline.plays[order[i]];
        if (play.reach !== "in") continue;
        const distance = Math.abs(scale.xOf(play.time) - x);
        if (!best || distance < best.distance) best = { play, distance };
      }
      return best;
    },
    [order, scale, timeline],
  );

  const localX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? Math.min(Math.max(clientX - rect.left, 0), rect.width) : 0;
  };

  function hoverAt(x: number): Hover {
    const segment = scale.segments.find((s) => x >= s.x0 && x <= s.x1) ?? null;
    const near = segment?.kind === "period" ? nearest(x) : null;
    return { x, play: near?.play ?? null, snap: !!near && near.distance <= SNAP_PX, time: scale.tOf(x), segment };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressRef.current = { x: localX(e.clientX), scrubbing: false, wasPlaying: !!video && !video.paused };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const x = localX(e.clientX);
    const press = pressRef.current;
    if (press && video && !press.scrubbing && Math.abs(x - press.x) > DRAG_PX) {
      press.scrubbing = true;
      if (press.wasPlaying) video.pause();
    }
    if (press?.scrubbing) {
      // 1:1 with the pointer; the video catches up a frame at a time.
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      frameSeek.schedule(scale.tOf(x));
    }
    setHover(hoverAt(x));
  }

  /** The press that just ended was a scrub: the click that follows it isn't a click. */
  const scrubbedRef = useRef(false);

  function onPointerUp() {
    const press = pressRef.current;
    pressRef.current = null;
    scrubbedRef.current = !!press?.scrubbing;
    if (!press?.scrubbing) return;
    frameSeek.settle();
    if (press.wasPlaying) video?.play().catch(() => {});
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (scrubbedRef.current) {
      scrubbedRef.current = false;
      return;
    }
    // The second click of a double-click is the zoom's.
    if (e.detail > 1) return;
    const at = hoverAt(localX(e.clientX));
    if (at.play && at.snap) onPlay(at.play);
    else if (video) onSeek(at.time);
    else if (at.play) onPlay(at.play);
  }

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const at = hoverAt(localX(e.clientX));
    if (zoomPeriod !== null) onZoom(null);
    else if (at.segment?.kind === "period" && at.segment.period !== undefined) onZoom(at.segment.period);
  }

  // What the tooltip says: the score first, then where and what.
  const tip = useMemo(() => {
    if (!hover) return null;
    if (hover.segment && hover.segment.kind !== "period") {
      return { head: notchName(hover.segment), where: null, what: null, extra: null };
    }
    const play = hover.play;
    if (!play) return null;
    const e = play.event;
    const score = scoreAfter(flow, e.eventId);
    const kinds = moments.get(e.eventId);
    const run = kinds?.has("run") ? flow.runs.find((r) => {
      const from = flow.indexOf.get(r.fromEventId) ?? -1;
      const to = flow.indexOf.get(r.toEventId) ?? -1;
      const at = flow.indexOf.get(e.eventId) ?? -2;
      return at >= from && at <= to;
    }) : undefined;
    const extra = [
      flow.leadChanges.includes(e.eventId) ? "Lead change" : null,
      flow.ties.includes(e.eventId) && score ? `Tied at ${score.home}` : null,
      run ? `Run · ${run.team === 1 ? teams.home.name : teams.away.name} ${run.points}–0` : null,
      kinds?.has("after_timeout") ? "After a timeout" : null,
    ].filter(Boolean).join(" · ");
    return {
      head: score ? `${score.home}–${score.away}` : null,
      where: `${periodLabel(e.period)} · ${formatGameClock(e.gameClockTime)}`,
      what: describePlay(e),
      extra: extra || null,
    };
  }, [hover, flow, moments, teams]);

  const final = flow.final;
  const lead = flow.largestLead.home && (!flow.largestLead.away || flow.largestLead.home.lead >= flow.largestLead.away.lead)
    ? `${teams.home.name} +${flow.largestLead.home.lead}`
    : flow.largestLead.away
      ? `${teams.away.name} +${flow.largestLead.away.lead}`
      : null;
  const facts = flow.source === "none" ? [] : [
    `${flow.leadChanges.length} lead ${flow.leadChanges.length === 1 ? "change" : "changes"}`,
    `${flow.ties.length} ${flow.ties.length === 1 ? "tie" : "ties"}`,
    lead ? `Largest lead ${lead}` : null,
  ].filter(Boolean);

  const zoomOptions = [
    { value: "all", label: "Whole game" },
    ...timeline.bands.map((b) => ({ value: String(b.period), label: b.label })),
  ];

  const valueText = activePlay
    ? `${periodLabel(activePlay.event.period)} ${formatGameClock(activePlay.event.gameClockTime)}${(() => {
        const s = scoreAfter(flow, activePlay.event.eventId);
        return s ? `, ${teams.home.name} ${s.home}, ${teams.away.name} ${s.away}` : "";
      })()}`
    : "Before the first play";

  return (
    <section aria-label="Game timeline" className={cn("@container/strip relative z-10 shrink-0 border-t border-separator bg-background px-4 pt-2 pb-2.5 select-none", className)}>
      <div className="flex h-7 items-center gap-3">
        {final && (
          <p className="flex min-w-0 shrink items-baseline gap-1.5 text-callout">
            <span className="truncate">{teams.home.name}</span>
            <span className="shrink-0 font-semibold nums">
              {final.home}–{final.away}
            </span>
            <span className="truncate">{teams.away.name}</span>
          </p>
        )}
        {facts.length > 0 && <p className="hidden min-w-0 truncate text-subheadline text-muted-foreground nums @min-[760px]/strip:block">{facts.join(" · ")}</p>}
        {timeline.bands.length > 1 && (
          <PopUpButton
            aria-label="Timeline zoom"
            size="sm"
            align="end"
            className="ml-auto"
            value={zoomPeriod === null ? "all" : String(zoomPeriod)}
            onValueChange={(v) => onZoom(v === "all" ? null : Number(v))}
            options={zoomOptions}
          />
        )}
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Position in the game"
        aria-valuemin={0}
        aria-valuemax={Math.round(timeline.domain.end)}
        aria-valuenow={Math.round(activePlay?.time ?? 0)}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        onPointerCancel={() => {
          pressRef.current = null;
        }}
        onPointerLeave={() => {
          if (!pressRef.current) setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        className="relative mt-1 touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection"
        style={{ height: Y.height }}
      >
        {width > 0 && (
          <StripDrawing
            scale={scale}
            timeline={timeline}
            flow={flow}
            marks={marks}
            teams={teams}
            tints={tints}
            dimmed={dimmed}
            inTarget={inTarget}
            stints={stints}
            clutch={clutch}
            zoomed={zoomPeriod !== null}
            patternId={patternId}
          />
        )}

        {/* Where the pointer is; the play a click would mean lights up as a second line. */}
        {hover && (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground/35" style={{ transform: `translateX(${hover.snap && hover.play ? scale.xOf(hover.play.time) : hover.x}px)` }} />
        )}

        <div
          ref={playheadRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 -ml-px w-0.5 rounded-full bg-foreground shadow-[0_0_0_1px_var(--background)]"
          style={{ opacity: 0 }}
        >
          <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_var(--background)]" />
        </div>

        {hover && tip && (
          <div
            role="presentation"
            className="pointer-events-none absolute bottom-full z-30 mb-2 w-max max-w-72 -translate-x-1/2 rounded-md bg-popover px-2.5 py-1.5 text-subheadline text-popover-foreground shadow-menu ring-1 ring-separator"
            style={{ left: Math.min(Math.max(hover.x, 110), Math.max(110, width - 110)) }}
          >
            <p className="flex items-baseline gap-2 nums">
              {tip.head && <span className="text-callout font-semibold">{tip.head}</span>}
              {tip.where && <span className="text-muted-foreground">{tip.where}</span>}
            </p>
            {tip.what && <p className="truncate">{tip.what}</p>}
            {tip.extra && <p className="text-muted-foreground">{tip.extra}</p>}
            {timeline.axis === "video" && video && hover.segment?.kind === "period" && (
              <p className="text-muted-foreground nums">{formatVideoTime(hover.snap && hover.play ? hover.play.time : hover.time)} in the video</p>
            )}
          </div>
        )}
      </div>

      {hint && <p className="mt-1.5 text-subheadline text-muted-foreground">{hint}</p>}
    </section>
  );
}
