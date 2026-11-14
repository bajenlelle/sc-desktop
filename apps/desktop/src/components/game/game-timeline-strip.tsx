import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { describePlay, formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import { flowChart, scoreAfter, type CourtStint, type GameFlow, type GameMoment } from "@scoutable/shared/lib/game-flow";
import { RUN_LABEL_WIDTH, placePeakLabel, placeRunLabels, placeTimeoutMarks, stripShowsPlays, stripTargetAt, type StripRun, type StripTarget, type StripTimeout, type StripZone } from "@scoutable/shared/lib/game-strip";
import { gameScale, playIndexAt, type GameScale, type GameTimeline, type ScaleSegment, type TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { clamp, rubberband } from "@scoutable/shared/lib/motion-math";
import { swipeTime } from "@scoutable/shared/lib/wheel-scrub";
import type { GameMarks } from "@scoutable/shared/types/game-marks";
import { useFrameSeek } from "@/components/editor/use-frame-seek";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { teamTints, type TeamTints } from "./team-tints";
import { useWheelScrub } from "./use-wheel-scrub";

/** The strip's lanes, top to bottom, in pixels. */
const Y = {
  periods: 0,
  periodsH: 18,
  chart: 22,
  chartH: 64,
  stint: 88,
  stintH: 3,
  lane: 93,
  laneH: 11,
  height: 104,
} as const;

/** The middle of the lane under the graph: home's play marks stand above it, away's below, the playlist's dots on it. */
const LANE_MID = Y.lane + Y.laneH / 2;
/** A play's mark in the lane. */
const MARK_H = 5;

/** Everything the timeline takes under the Now bar: its track, the line of facts and zoom under it, and the air below. */
export const GAME_TIMELINE_HEIGHT = Y.height + 44;

/** How near (px) the pointer must be to a play for a click to mean that play. */
const SNAP_PX = 4;
/** Movement (px) that makes a press a scrub and not a click. */
const DRAG_PX = 4;
/** How near (px) a press must be to the playhead to grab it where it is. */
const PLAYHEAD_HIT = 10;
/** At the whole game's width only the largest runs are drawn. */
const RUNS_SHOWN = 6;

/** A word on the graph keeps a rim of the page's colour, so the line it crosses doesn't strike it through. */
const HALO = { paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3, strokeLinejoin: "round" } as const;

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
 * The scale the strip is drawn with. A change of zoom (the whole game, or one
 * quarter) springs from the scale on screen to the new one, so the quarter
 * grows to fill the strip and its neighbours slide out the sides they came
 * from; a new zoom asked for mid-flight starts from wherever the strip is.
 * A change of width or of the game itself is not a gesture and simply applies.
 * Under reduced motion the zoom cuts.
 */
function useZoomedScale(timeline: GameTimeline, width: number, zoomPeriod: number | null): { scale: GameScale; settled: boolean } {
  const reduced = useReducedMotionSafe();
  const whole = useMemo(() => gameScale(timeline, width), [timeline, width]);
  const target = useMemo(() => (zoomPeriod === null ? whole : gameScale(timeline, width, { zoomPeriod })), [timeline, width, zoomPeriod, whole]);
  const [blend, setBlend] = useState<GameScale | null>(null);
  const shown = useRef<GameScale>(target);
  const last = useRef({ zoomPeriod, whole });

  useEffect(() => {
    const zoomChanged = last.current.zoomPeriod !== zoomPeriod;
    const sameGame = last.current.whole === whole;
    last.current = { zoomPeriod, whole };
    if (!zoomChanged || !sameGame || reduced) {
      shown.current = target;
      setBlend(null);
      return;
    }
    // From what is on screen now (a settled scale, or a zoom still in flight).
    const from = shown.current.xOf;
    const controls = animate(0, 1, {
      ...springs.standard,
      onUpdate: (p) => {
        const xOf = (t: number) => {
          const a = from(t);
          return a + (target.xOf(t) - a) * p;
        };
        // The whole game's stretches, each where the blend puts it: those leaving the strip collapse into its edges.
        const mid: GameScale = {
          width,
          segments: whole.segments.map((s) => ({ ...s, x0: xOf(s.t0), x1: xOf(s.t1) })),
          xOf,
          tOf: target.tOf,
        };
        shown.current = mid;
        setBlend(mid);
      },
      onComplete: () => {
        shown.current = target;
        setBlend(null);
      },
    });
    return () => controls.stop();
  }, [target, whole, zoomPeriod, width, reduced]);

  if (!blend) shown.current = target;
  return { scale: blend ?? target, settled: blend === null };
}

/**
 * Everything on the strip that doesn't move with playback, drawn once per
 * game, width, zoom and filter: the period bands with their scores, the
 * score graph with its runs (each a shaded stretch with its score printed)
 * and timeouts (a pause mark on the calling side, a hairline through the
 * graph), the clutch stretch, a chosen player's stints on the floor, and in
 * the lane under the graph the playlist's plays as dots and, when the strip
 * marks them, the listed plays in one colour.
 *
 * No mark per play for the whole unfiltered game: at that width they are a
 * mark every other pixel, and the list beside the strip names every one.
 */
const StripDrawing = memo(function StripDrawing({
  scale,
  timeline,
  flow,
  teams,
  tints,
  runs,
  timeouts,
  listed,
  inTarget,
  stints,
  clutch,
  zoomed,
  patternId,
}: {
  scale: GameScale;
  timeline: GameTimeline;
  flow: GameFlow;
  teams: Teams;
  tints: TeamTints;
  /** The runs on the strip, where they are. */
  runs: readonly StripRun[];
  /** The timeouts on the strip, where they are. */
  timeouts: readonly StripTimeout[];
  /** The plays the list shows, by key, when the strip marks them; null when it doesn't. */
  listed: ReadonlySet<string> | null;
  inTarget: ReadonlySet<string>;
  stints: readonly CourtStint[] | null;
  /** The clutch stretch on the axis, when the game has one. */
  clutch: { from: number; to: number } | null;
  /** Settled on one quarter (not the whole game, and not on the way between the two). */
  zoomed: boolean;
  patternId: string;
}) {
  const width = scale.width;
  const playByEvent = useMemo(() => new Map(timeline.plays.map((p) => [p.event.eventId, p])), [timeline]);
  const xOfEvent = (eventId: number) => {
    const p = playByEvent.get(eventId);
    return p ? scale.xOf(p.time) : null;
  };
  /** On the strip, not parked at an edge by a zoom. */
  const inside = (x: number) => x > 0.5 && x < width - 0.5;

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
  const peakAt = peak ? xOfEvent(peak.eventId) : null;
  const peakX = peakAt !== null && inside(peakAt) ? peakAt : null;

  // Past the folded stretch before tip-off, when the strip starts with one.
  const lead = scale.segments[0];
  const legendX = lead && lead.kind !== "period" ? lead.x1 : 0;

  // The words on the graph keep clear of the team names, which are as long as the names are.
  const homeName = useRef<SVGTextElement | null>(null);
  const awayName = useRef<SVGTextElement | null>(null);
  const [names, setNames] = useState({ home: 0, away: 0 });
  const hasChart = chart !== null;
  useLayoutEffect(() => {
    const home = homeName.current?.getComputedTextLength() ?? 0;
    const away = awayName.current?.getComputedTextLength() ?? 0;
    setNames((was) => (Math.abs(was.home - home) < 0.5 && Math.abs(was.away - away) < 0.5 ? was : { home, away }));
  }, [teams.home.name, teams.away.name, hasChart]);
  // A name starts 15 px in, after its swatch; 4 px of air after it.
  const legend = { x: legendX, home: names.home ? names.home + 19 : 0, away: names.away ? names.away + 19 : 0 };
  const runScores = placeRunLabels(runs, { width, legend });
  const timeoutRows = new Map(placeTimeoutMarks(timeouts, { legend }).map((t) => [t.id, t.row]));
  // The largest lead's figure stands just inside the leading side's edge, where that side's timeouts and its runs'
  // scores are: a row in under or beside one.
  const peakLabel =
    peak && peakX !== null
      ? placePeakLabel(peakX, {
          width,
          marks: [
            ...timeouts.filter((t) => t.team === peak.side).map((t) => ({ x: t.x, row: timeoutRows.get(t.id) ?? 0 })),
            ...runScores.filter((score) => runs.find((r) => r.id === score.id)?.team === peak.side).map((score) => ({ x: score.x, row: score.row, width: RUN_LABEL_WIDTH })),
          ],
        })
      : null;

  return (
    <svg width={width} height={Y.height} className="absolute inset-0 block text-foreground" aria-hidden>
      <defs>
        <pattern id={`${patternId}-away`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
          <line x1="0" y1="0" x2="0" y2="5" strokeWidth="1.5" stroke={tints.away} strokeOpacity={0.55} />
        </pattern>
        {/* While a zoom is under way, what leaves the strip gathers at its edges: keep the last pixel of each side clear. */}
        <clipPath id={`${patternId}-clip`}>
          <rect x={1} y={-2} width={Math.max(0, width - 2)} height={Y.height + 4} />
        </clipPath>
      </defs>

      {/* Periods as bands; the footage around them (before tip-off, the breaks, after the whistle) folded into the
          gaps between them. A stretch folded too thin to read as a gap is a line. */}
      {scale.segments.map((s, i) => {
        const w = s.x1 - s.x0;
        if (w < 0.5) return null;
        if (s.kind !== "period") {
          return w > 3 ? null : (
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
                className="text-subheadline font-medium nums"
                style={{ fill: "var(--muted-foreground)", whiteSpace: "pre" }}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      <g clipPath={`url(#${patternId}-clip)`}>
        {/* Clutch time: a line under its stretch of the period band. */}
        {clutch && scale.xOf(clutch.to) - scale.xOf(clutch.from) > 2 && (
          <line
            x1={scale.xOf(clutch.from)}
            x2={scale.xOf(clutch.to)}
            y1={Y.periods + Y.periodsH + 1.5}
            y2={Y.periods + Y.periodsH + 1.5}
            strokeWidth="1.5"
            style={{ stroke: "var(--muted-foreground)" }}
          />
        )}

        {/* The score difference: home above the line, away below. */}
        <g transform={`translate(0 ${Y.chart})`}>
          {chart ? (
            <>
              {/* Runs: the stretch a team scored unanswered, shaded in its colour over the graph's whole height, as a
                  chart marks a period. Its score is printed further down, over the line. */}
              {runs.map((run) => (
                <rect
                  key={run.id}
                  data-strip="run"
                  data-id={run.id}
                  x={run.x0}
                  y={0}
                  width={run.x1 - run.x0}
                  height={Y.chartH}
                  rx="3"
                  fill={run.team === 1 ? tints.home : tints.away}
                  // A little under the side's own fill: a grey away side is fainter to begin with, and stays so.
                  fillOpacity={(run.team === 1 ? tints.homeOpacity : tints.awayOpacity) * 0.75}
                />
              ))}
              <path d={chart.home} fill={tints.home} fillOpacity={tints.homeOpacity} />
              <path d={chart.away} fill={tints.away} fillOpacity={tints.awayOpacity} />
              {tints.awayHatch && <path d={chart.away} fill={`url(#${patternId}-away)`} />}
              <line x1={0} x2={width} y1={chart.zeroY} y2={chart.zeroY} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
              <path d={chart.line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

              {/* The one number worth printing: the largest lead, at its peak. */}
              {peak && peakLabel && (
                <text
                  data-strip="peak"
                  x={peakLabel.x}
                  // On the zero line's side of the peak, inside the area: the edges belong to the runs and the timeouts
                  // (under a timeout's mark, a row further in).
                  y={
                    peak.side === 1
                      ? Math.max(chart.yOf(peak.lead) + 12, peakLabel.row ? 27 : 0)
                      : Math.min(chart.yOf(-peak.lead) - 5, peakLabel.row ? Y.chartH - 19 : Y.chartH)
                  }
                  textAnchor="middle"
                  className="text-caption font-semibold nums"
                  style={{ fill: "var(--foreground)", ...HALO }}
                >
                  +{peak.lead}
                </text>
              )}

              {/* A run reads as its score, on the running side's edge (a row in where a team name stands). */}
              {runScores.map((score) => {
                const run = runs.find((r) => r.id === score.id);
                if (!run) return null;
                return (
                  <text
                    key={score.id}
                    data-strip="run-score"
                    x={score.x}
                    y={run.team === 1 ? 11 + score.row * 13 : Y.chartH - 4 - score.row * 13}
                    textAnchor="middle"
                    className="text-caption font-semibold nums"
                    style={{ fill: "var(--foreground)", ...HALO }}
                  >
                    {run.points}–0
                  </text>
                );
              })}
            </>
          ) : (
            <text x={width / 2} y={Y.chartH / 2 + 4} textAnchor="middle" className="text-callout" style={{ fill: "var(--muted-foreground)" }}>
              This game has no score on record, so there is no score graph.
            </text>
          )}

          {/* Timeouts: play stopped, so a pause mark, on the calling side's edge (the officials' on the line), and a
              hairline through the graph: whether the timeout ended a run is read off the two together. */}
          {timeouts.map((t) => {
            const row = timeoutRows.get(t.id) ?? 0;
            const y = t.team === 1 ? 1 + row * 13 : t.team === 2 ? Y.chartH - 9 - row * 13 : Y.chartH / 2 - 4;
            const bar = { fill: "var(--muted-foreground)" };
            return (
              <g key={t.id} data-strip="timeout" data-id={t.id}>
                <line x1={t.x} x2={t.x} y1={0} y2={Y.chartH} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
                <rect data-strip="timeout-mark" x={t.x - 5.5} y={y - 1.5} width={11} height={11} rx="3" style={{ fill: "var(--background)" }} />
                <rect x={t.x - 3.6} y={y} width={2.6} height={8} rx="1" style={bar} />
                <rect x={t.x + 1} y={y} width={2.6} height={8} rx="1" style={bar} />
              </g>
            );
          })}
        </g>

        {/* A chosen player's stints on the floor. */}
        {(stints ?? []).map((s) => {
          const from = xOfEvent(s.fromEventId);
          const to = xOfEvent(s.toEventId);
          if (from === null || to === null || (!inside(from) && !inside(to) && to - from < 1)) return null;
          // In the accent, so it never reads as one of the run bars just above it.
          return <rect key={s.fromEventId} x={from} y={Y.stint} width={Math.max(2, to - from)} height={Y.stintH} rx="1.5" style={{ fill: "var(--primary)" }} />;
        })}

        {/* The plays the list shows, when the strip marks them: home above the lane's middle, away below, in one
            colour. What kind of play each is, the list and the line under the track say. */}
        {listed &&
          timeline.plays.map((p) => {
            if (p.reach !== "in" || !listed.has(p.key)) return null;
            const side = p.event.eventTeam?.teamNumber ?? p.event.player?.teamNumber;
            if (side !== 1 && side !== 2) return null;
            const x = scale.xOf(p.time);
            if (!inside(x)) return null;
            return (
              <rect
                key={p.key}
                data-strip="play-mark"
                x={x - 0.75}
                y={side === 1 ? LANE_MID - MARK_H - 0.5 : LANE_MID + 0.5}
                width={1.5}
                height={MARK_H}
                rx="0.75"
                fill="currentColor"
                fillOpacity={0.6}
              />
            );
          })}

        {/* The plays already in the playlist, always: where the coach's own clips are in the game. */}
        {timeline.plays.map((p) => {
          if (p.reach !== "in" || !inTarget.has(p.key)) return null;
          const x = scale.xOf(p.time);
          if (!inside(x)) return null;
          return (
            <g key={p.key} data-strip="in-playlist">
              <circle cx={x} cy={LANE_MID} r="3.4" style={{ fill: "var(--background)" }} />
              <circle cx={x} cy={LANE_MID} r="2.4" style={{ fill: "var(--primary)" }} />
            </g>
          );
        })}
      </g>

      {/* Who is above and who is below: the graph's legend, on the graph, starting where the first quarter does
          (a game opens with the playhead on the stretch before it). */}
      {chart && (
        <g transform={`translate(${legendX} ${Y.chart})`} className="text-footnote font-medium" style={{ fill: "var(--muted-foreground)" }}>
          <rect x={4} y={3} width={7} height={7} rx="1.5" fill={tints.home} fillOpacity={0.7} />
          <text ref={homeName} x={15} y={10} style={HALO}>
            {teams.home.name}
          </text>
          <rect x={4} y={Y.chartH - 11} width={7} height={7} rx="1.5" fill={tints.away} fillOpacity={0.6} />
          <text ref={awayName} x={15} y={Y.chartH - 4} style={HALO}>
            {teams.away.name}
          </text>
        </g>
      )}
    </svg>
  );
});

/** What the page around the timeline can ask of it. */
export interface GameTimelineHandle {
  /** Moves the playhead by this many of the timeline's pixels, as a sideways swipe does (positive is later). */
  scrubBy: (px: number) => void;
  /** The swipe is over. */
  endScrub: () => void;
}

interface Hover {
  x: number;
  /** What the pointer is on, which is what a click means (stripTargetAt). */
  target: StripTarget;
  /** The play the line under the track describes: the mark the pointer is on, else the play going on at that second. */
  play: TimedPlay | null;
  /** On a play's mark: a click plays that play. */
  snap: boolean;
  time: number;
  segment: ScaleSegment | null;
}

/** Which of the strip's rows a height is in. The lane takes the thin row above it too: its marks are small. */
const zoneOf = (y: number): StripZone => (y < Y.chart ? "band" : y < Y.stint - 2 ? "chart" : "lane");

/**
 * The game on one strip: both the scrubber over the whole video and the
 * overview of how the game went. Quarters are bands (the breaks folded into
 * the gaps between them, so the strip is spent on basketball), the score
 * difference runs through them with its runs and timeouts on it, and the
 * playhead crosses all of it. The plays themselves are marked when a filter
 * is on or one quarter has the strip (stripShowsPlays): then they answer a
 * question, and there is room to read them.
 *
 * It answers the press, not the release: the playhead goes to the pointer
 * the moment the button is down and follows it 1:1 from there (from where it
 * was grabbed, when the press is on the playhead itself), the video catching
 * up a frame at a time; past either end it resists and springs back. A
 * sideways swipe on a trackpad moves it the same way, a pixel for a pixel,
 * over the timeline and (through `handleRef`) over the footage. Let go
 * without having moved and it was a click on what the pointer was on: a
 * run or a timeout (the place Page Down stops at), a play's mark (that play
 * from its pre-roll, exactly as its row would), else that second.
 * Double-click a quarter to give it the whole strip.
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
  stintName,
  zoomPeriod,
  onZoom,
  onPlay,
  onSeek,
  onLandmark,
  onScrubEnd,
  hint,
  className,
  handleRef,
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
  /** Whose stints they are, for the hover. */
  stintName: string | null;
  zoomPeriod: number | null;
  onZoom: (period: number | null) => void;
  onPlay: (play: TimedPlay) => void;
  onSeek: (t: number) => void;
  /** A click on a run or a timeout: its row in the list (`run:<first basket>`, `timeout:<event>`). */
  onLandmark: (row: string) => void;
  /** The timeline moved the video, said once: a drag let go, a swipe come to rest, or a click where no play is (a click on a play is `onPlay`). */
  onScrubEnd?: (via: "timeline" | "timeline_drag" | "wheel") => void;
  /** A first-visit line under the track, in the game facts' place; gone after the first use. */
  hint: string | null;
  className?: string;
  handleRef?: Ref<GameTimelineHandle>;
}) {
  const patternId = useId().replace(/:/g, "");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadX = useMotionValue(0);
  const [playheadShown, setPlayheadShown] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const scrubRef = useRef<{ grabOffset: number; startX: number; startY: number; moved: boolean; wasPlaying: boolean } | null>(null);
  // A sideways swipe under way: it holds the playhead as a press does. `t` is where it has taken the video.
  const swipeRef = useRef<{ wasPlaying: boolean; t: number } | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const frameSeek = useFrameSeek(video, onSeek);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { scale, settled } = useZoomedScale(timeline, Math.max(1, width), zoomPeriod);
  const tints = useMemo(() => teamTints(teams.home.color, teams.away.color), [teams.home.color, teams.away.color]);

  // Settled on one quarter (not the whole game, and not on the way between the two).
  const zoomedIn = settled && zoomPeriod !== null;
  const playsShown = stripShowsPlays({ filtered, zoomed: zoomedIn });
  const listed = useMemo(() => (playsShown ? new Set(order.map((i) => timeline.plays[i].key)) : null), [playsShown, order, timeline]);

  const playByEvent = useMemo(() => new Map(timeline.plays.map((p) => [p.event.eventId, p])), [timeline]);
  // The runs on the strip: all of them in one quarter, the largest at the whole game's width.
  const stripRuns = useMemo<StripRun[]>(() => {
    const shown = zoomedIn ? flow.runs : [...flow.runs].sort((a, b) => b.points - a.points).slice(0, RUNS_SHOWN);
    return shown.flatMap((run) => {
      const first = playByEvent.get(run.fromEventId);
      const last = playByEvent.get(run.toEventId);
      if (!first || !last) return [];
      const x0 = scale.xOf(first.time);
      const x1 = Math.max(scale.xOf(last.time), x0 + 4);
      return x1 > 0.5 && x0 < width - 0.5 ? [{ id: run.fromEventId, team: run.team, points: run.points, x0, x1 }] : [];
    });
  }, [flow, playByEvent, scale, width, zoomedIn]);
  const stripTimeouts = useMemo<StripTimeout[]>(
    () =>
      (marks?.timeouts ?? []).flatMap((t) => {
        const time = timeline.timeOf(t.realWorldTime, t.period);
        if (time === null) return [];
        const x = scale.xOf(time);
        return x > 0.5 && x < width - 0.5 ? [{ id: t.eventId, team: t.teamNumber ?? 0, x }] : [];
      }),
    [marks, timeline, scale, width],
  );

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

  // The playhead follows playback at the display rate, off React: one motion
  // value moved by a frame loop while the video plays. While the coach holds
  // it, the pointer drives it instead.
  useEffect(() => {
    if (!video) {
      // No footage: the line marks the selected play.
      setPlayheadShown(!!activePlay);
      if (activePlay) playheadX.set(scale.xOf(activePlay.time));
      return;
    }
    setPlayheadShown(true);
    let raf = 0;
    const paint = () => {
      if (!scrubRef.current && !swipeRef.current) playheadX.set(scale.xOf(video.currentTime));
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
  }, [video, scale, activePlay, playheadX]);

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

  /** The pointer on the track, in its own pixels; not clamped, so a drag past an end is known as one. */
  const localX = (clientX: number) => clientX - (trackRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (trackRef.current?.getBoundingClientRect().top ?? 0);

  function hoverAt(x: number, y: number): Hover {
    const at = clamp(x, 0, width);
    const time = scale.tOf(at);
    const segment = scale.segments.find((s) => at >= s.x0 && at <= s.x1) ?? null;
    const near = segment?.kind === "period" ? nearest(at) : null;
    const target = stripTargetAt(
      { x: at, zone: zoneOf(y) },
      { timeouts: stripTimeouts, runs: stripRuns, play: near ? { key: near.play.key, distance: near.distance } : null, playsShown, snapPx: SNAP_PX },
    );
    let play: TimedPlay | null = null;
    if (target.kind === "play") play = near?.play ?? null;
    // No footage: a click selects the listed play nearest it, as it always has.
    else if (!video) play = near?.play ?? null;
    else if (segment?.kind === "period") {
      const i = playIndexAt(timeline.plays, order, time);
      play = i >= 0 ? timeline.plays[order[i]] : null;
    }
    return { x: at, target, play, snap: target.kind === "play", time, segment };
  }

  /** Moves the held playhead to the pointer: 1:1 inside the strip, resisting past its ends. */
  function scrubTo(x: number) {
    const s = scrubRef.current;
    if (!s) return;
    const raw = x - s.grabOffset;
    const over = raw < 0 ? raw : raw > width ? raw - width : 0;
    playheadX.set(clamp(raw, 0, width) + rubberband(over, width));
    frameSeek.schedule(scale.tOf(clamp(raw, 0, width)));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = localX(e.clientX);
    if (!video) {
      // Nothing to scrub: the release is a click that selects a play.
      scrubRef.current = { grabOffset: 0, startX: x, startY: localY(e.clientY), moved: false, wasPlaying: false };
      return;
    }
    // A press takes over from a swipe that is still coming to rest: it is one hold now, and whether the video
    // carries on is settled when the press ends, not under the held pointer.
    const swipe = swipeRef.current;
    if (swipe) {
      swipeRef.current = null;
      onScrubEnd?.("wheel");
    }
    // On the playhead itself, keep hold of it where it was grabbed; anywhere else, it comes to the pointer.
    const onPlayhead = Math.abs(x - playheadX.get()) <= PLAYHEAD_HIT;
    scrubRef.current = {
      grabOffset: onPlayhead ? x - playheadX.get() : 0,
      startX: x,
      startY: localY(e.clientY),
      moved: false,
      wasPlaying: swipe ? swipe.wasPlaying : !video.paused,
    };
    if (!video.paused) video.pause();
    setPressed(true);
    if (!onPlayhead) scrubTo(x);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const x = localX(e.clientX);
    const s = scrubRef.current;
    if (s) {
      if (Math.abs(x - s.startX) > DRAG_PX) s.moved = true;
      if (video && s.moved) scrubTo(x);
    }
    setHover(hoverAt(x, localY(e.clientY)));
  }

  function endPress(cancelled: boolean) {
    const s = scrubRef.current;
    if (!s) return;
    scrubRef.current = null;
    setPressed(false);
    if (video) {
      frameSeek.settle();
      // Let go past an end: the playhead springs back to it.
      const rest = clamp(playheadX.get(), 0, width);
      if (rest !== playheadX.get()) animate(playheadX, rest, springs.settle);
    }
    if (cancelled) {
      if (s.wasPlaying) video?.play().catch(() => {});
      return;
    }
    if (s.moved) {
      // A scrub: playback carries on from where it was dropped.
      if (s.wasPlaying) video?.play().catch(() => {});
      if (video) onScrubEnd?.("timeline_drag");
      return;
    }
    // A click. (Both clicks of a double-click land here, on the same spot, before the zoom: the second changes nothing.)
    const at = hoverAt(s.startX, s.startY);
    if (at.target.kind === "run" || at.target.kind === "timeout") onLandmark(`${at.target.kind}:${at.target.id}`);
    else if (at.play && (at.snap || !video)) onPlay(at.play);
    else if (video) {
      onSeek(at.time);
      onScrubEnd?.("timeline");
      if (s.wasPlaying) video.play().catch(() => {});
    }
  }

  // A sideways swipe: the playhead moves with the fingers, a pixel for a pixel on the timeline's own scale
  // (so a zoomed quarter scrubs finer), the video catching up a frame at a time, and stops at the ends. Zoomed
  // on a quarter the video isn't in, the video goes on from where it is (swipeTime).
  const scrubBy = (px: number) => {
    if (!video || scrubRef.current) return;
    if (!swipeRef.current) {
      swipeRef.current = { wasPlaying: !video.paused, t: video.currentTime };
      if (!video.paused) video.pause();
    }
    const s = swipeRef.current;
    s.t = swipeTime(s.t, px, scale, { min: timeline.domain.start, max: timeline.domain.end });
    playheadX.set(scale.xOf(s.t));
    frameSeek.schedule(s.t);
  };
  const endSwipe = () => {
    const s = swipeRef.current;
    if (!s) return;
    swipeRef.current = null;
    frameSeek.settle();
    if (s.wasPlaying) video?.play().catch(() => {});
    onScrubEnd?.("wheel");
  };
  const swipe = useRef({ scrubBy, endSwipe });
  swipe.current = { scrubBy, endSwipe };
  useImperativeHandle(handleRef, () => ({ scrubBy: (px) => swipe.current.scrubBy(px), endScrub: () => swipe.current.endSwipe() }), []);
  useWheelScrub(trackRef, { enabled: !!video, onScrub: (px) => swipe.current.scrubBy(px), onEnd: () => swipe.current.endSwipe() });

  // The readout is centred on the pointer and kept inside the strip, whatever it has to say.
  useLayoutEffect(() => {
    const el = readoutRef.current;
    if (!el || !hover) return;
    const w = el.offsetWidth;
    el.style.transform = `translateX(${clamp(hover.x - w / 2, 0, Math.max(0, width - w))}px)`;
  });

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const at = hoverAt(localX(e.clientX), localY(e.clientY));
    if (zoomPeriod !== null) onZoom(null);
    else if (at.segment?.kind === "period" && at.segment.period !== undefined) onZoom(at.segment.period);
  }

  // What the tooltip says: the score first, then where and what.
  const tip = useMemo(() => {
    if (!hover) return null;
    const target = hover.target;
    if (target.kind === "timeout") {
      const t = marks?.timeouts.find((x) => x.eventId === target.id);
      if (!t) return null;
      return {
        head: "Timeout",
        where: t.teamNumber === 1 ? teams.home.name : t.teamNumber === 2 ? teams.away.name : "Officials",
        what: [periodLabel(t.period), t.clock].filter(Boolean).join(" · "),
        extra: t.scoreHome !== null && t.scoreAway !== null ? `${t.scoreHome}–${t.scoreAway}` : null,
      };
    }
    if (target.kind === "run") {
      const run = flow.runs.find((r) => r.fromEventId === target.id);
      if (!run) return null;
      const clock = (eventId: number) => {
        const e = flow.order[flow.indexOf.get(eventId) ?? -1];
        return e?.gameClockTime ? formatGameClock(e.gameClockTime) : null;
      };
      const [from, to] = [clock(run.fromEventId), clock(run.toEventId)];
      return {
        head: "Run",
        where: `${run.team === 1 ? teams.home.name : teams.away.name} ${run.points}–0`,
        what: [periodLabel(run.period), from && to ? `${from} to ${to}` : from].filter(Boolean).join(" · "),
        extra: null,
      };
    }
    if (hover.segment && hover.segment.kind !== "period") {
      return { head: notchName(hover.segment), where: null, what: null, extra: null };
    }
    const play = hover.play;
    if (!play) return null;
    const e = play.event;
    const score = scoreAfter(flow, e.eventId);
    const kinds = moments.get(e.eventId);
    const at = flow.indexOf.get(e.eventId) ?? -1;
    const within = (fromId: number, toId: number) => at >= (flow.indexOf.get(fromId) ?? Infinity) && at <= (flow.indexOf.get(toId) ?? -Infinity);
    const run = kinds?.has("run") ? flow.runs.find((r) => within(r.fromEventId, r.toEventId)) : undefined;
    const stint = stints?.find((s) => within(s.fromEventId, s.toEventId));
    const extra = [
      stint && stintName
        ? `${stintName} on the floor${stint.plusMinus !== null ? `: ${stint.plusMinus > 0 ? "+" : ""}${stint.plusMinus} in this stint` : ""}`
        : null,
      flow.leadChanges.includes(e.eventId) ? "Lead change" : null,
      flow.ties.includes(e.eventId) && score ? `Tied at ${score.home}` : null,
      run ? `Run · ${run.team === 1 ? teams.home.name : teams.away.name} ${run.points}–0` : null,
      kinds?.has("after_timeout") ? "After a timeout" : null,
      kinds?.has("clutch") ? "Clutch time" : null,
    ].filter(Boolean).join(" · ");
    return {
      head: score ? `${score.home}–${score.away}` : null,
      where: [periodLabel(e.period), e.gameClockTime && formatGameClock(e.gameClockTime)].filter(Boolean).join(" · "),
      what: describePlay(e),
      extra: extra || null,
    };
  }, [hover, flow, marks, moments, teams, stints, stintName]);

  const final = flow.final;
  const lead = flow.largestLead.home && (!flow.largestLead.away || flow.largestLead.home.lead >= flow.largestLead.away.lead)
    ? `${teams.home.name} +${flow.largestLead.home.lead}`
    : flow.largestLead.away
      ? `${teams.away.name} +${flow.largestLead.away.lead}`
      : null;
  const facts = flow.source === "none" ? [] : [
    final ? `Final ${final.home}–${final.away}` : null,
    `${flow.leadChanges.length} lead ${flow.leadChanges.length === 1 ? "change" : "changes"}`,
    `${flow.ties.length} ${flow.ties.length === 1 ? "tie" : "ties"}`,
    lead ? `Largest lead ${lead}` : null,
  ].filter(Boolean);

  /** The hover line sits on what a click would mean: the play's mark, the timeout's line, else the pointer. */
  const hoverLineX = (h: Hover) => {
    if (h.target.kind === "play" && h.play) return scale.xOf(h.play.time);
    if (h.target.kind === "timeout") {
      const id = h.target.id;
      return stripTimeouts.find((t) => t.id === id)?.x ?? h.x;
    }
    return h.x;
  };

  const zoomOptions = [
    { value: "all", label: "Whole game" },
    ...timeline.bands.map((b) => ({ value: String(b.period), label: b.label })),
  ];

  const valueText = activePlay
    ? `${[periodLabel(activePlay.event.period), activePlay.event.gameClockTime && formatGameClock(activePlay.event.gameClockTime)].filter(Boolean).join(" ")}${(() => {
        const s = scoreAfter(flow, activePlay.event.eventId);
        return s ? `, ${teams.home.name} ${s.home}, ${teams.away.name} ${s.away}` : "";
      })()}`
    : "Before the first play";

  return (
    <section aria-label="Game timeline" className={cn("relative z-10 shrink-0 pb-3 select-none", className)}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Position in the game"
        aria-valuemin={0}
        aria-valuemax={Math.round(timeline.domain.end)}
        aria-valuenow={Math.round(activePlay?.time ?? 0)}
        aria-valuetext={valueText}
        // A press with the mouse doesn't take the keyboard's focus ring: every key works from anywhere in the view.
        // It still ends typing in a field, as a click anywhere outside one does.
        onMouseDown={(e) => {
          e.preventDefault();
          if (document.activeElement instanceof HTMLElement && document.activeElement !== e.currentTarget) document.activeElement.blur();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endPress(false)}
        onPointerCancel={() => endPress(true)}
        onPointerLeave={() => {
          if (!scrubRef.current) setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        className="relative cursor-default touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection"
        style={{ height: Y.height }}
      >
        {width > 0 && (
          <StripDrawing
            scale={scale}
            timeline={timeline}
            flow={flow}
            teams={teams}
            tints={tints}
            runs={stripRuns}
            timeouts={stripTimeouts}
            listed={listed}
            inTarget={inTarget}
            stints={stints}
            clutch={clutch}
            zoomed={zoomedIn}
            patternId={patternId}
          />
        )}

        {/* Where the pointer is; over a play, the line sits on the play a click would mean. */}
        {hover && !pressed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground/35"
            style={{ transform: `translateX(${hoverLineX(hover)}px)` }}
          />
        )}

        <motion.div
          aria-hidden
          data-strip="playhead"
          className="pointer-events-none absolute inset-y-0 left-0 -ml-px w-0.5 rounded-full bg-foreground shadow-[0_0_0_1px_var(--background)] will-change-transform"
          style={{ x: playheadX, opacity: playheadShown ? 1 : 0 }}
        >
          <motion.span
            className="absolute -top-1 left-1/2 -ml-1 block size-2 rounded-full bg-foreground shadow-[0_0_0_1px_var(--background)]"
            animate={{ scale: pressed ? 1.5 : 1 }}
            transition={springs.snappy}
          />
        </motion.div>

        {/* What the pointer is on, in one line in the row under the track: above the track is the footage, and when
            the footage is as tall as the window allows there is no room for more between the track and the window's edge. */}
        {hover && tip && (
          <div
            ref={readoutRef}
            role="presentation"
            className="pointer-events-none absolute top-full left-0 z-30 mt-1 flex h-6 max-w-full items-center gap-2 rounded-md bg-material-popover px-2 text-subheadline whitespace-nowrap text-popover-foreground shadow-menu backdrop-blur-xl nums"
          >
            {tip.head && <span className="shrink-0 font-semibold">{tip.head}</span>}
            {tip.where && <span className="shrink-0 text-muted-foreground">{tip.where}</span>}
            {tip.what && <span className="min-w-0 truncate">{tip.what}</span>}
            {tip.extra && <span className="min-w-0 shrink-[4] truncate text-muted-foreground">{tip.extra}</span>}
            {timeline.axis === "video" && video && hover.segment?.kind === "period" && (
              <span className="shrink-0 text-muted-foreground">{formatVideoTime(hover.snap && hover.play ? hover.play.time : hover.time)} in the video</span>
            )}
          </div>
        )}
      </div>

      {/* Under the track, as a chart's legend is: the game in a line (on a first visit, how the timeline works, in the same place) and the zoom. */}
      <div className="mt-1 flex h-7 items-center gap-3">
        {(hint || facts.length > 0) && <p className="min-w-0 truncate text-subheadline text-muted-foreground nums">{hint ?? facts.join(" · ")}</p>}
        {timeline.bands.length > 1 && (
          <PopUpButton
            aria-label="Timeline zoom"
            size="sm"
            align="end"
            className="ml-auto shrink-0"
            value={zoomPeriod === null ? "all" : String(zoomPeriod)}
            onValueChange={(v) => onZoom(v === "all" ? null : Number(v))}
            options={zoomOptions}
          />
        )}
      </div>
    </section>
  );
}
