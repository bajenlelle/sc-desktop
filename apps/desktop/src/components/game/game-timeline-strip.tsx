import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { describePlay, formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import { flowChart, scoreAfter, type CourtStint, type GameFlow, type GameMoment } from "@scoutable/shared/lib/game-flow";
import {
  lineAlongEdge,
  RUN_LABEL_WIDTH,
  placePeakLabel,
  placeRunLabels,
  placeTimeoutMarks,
  runSpanText,
  runsOnStrip,
  stripShowsPlays,
  stripTargetAt,
  type StripRun,
  type StripTarget,
  type StripTimeout,
  type StripZone,
} from "@scoutable/shared/lib/game-strip";
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
  // The scale on screen: the target at rest, the blend in flight. Where the next zoom starts from.
  const shown = useRef<GameScale>(target);
  const last = useRef({ zoomPeriod, whole });
  // A zoom has been asked for and its spring hasn't begun (this render, before the effect below): the strip stays on
  // the scale it shows. Taking the target here would be the zoom done in one frame, with nothing left to spring.
  const starting = !reduced && last.current.zoomPeriod !== zoomPeriod && last.current.whole === whole;

  useEffect(() => {
    const zoomChanged = last.current.zoomPeriod !== zoomPeriod;
    const sameGame = last.current.whole === whole;
    last.current = { zoomPeriod, whole };
    if (!zoomChanged || !sameGame || reduced) {
      shown.current = target;
      setBlend(null);
      return;
    }
    // From what is on screen now (a settled scale, or a zoom still in flight), held until the spring's first frame.
    const start = shown.current;
    const from = start.xOf;
    setBlend(start);
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

  if (!blend && !starting) shown.current = target;
  return { scale: blend ?? (starting ? shown.current : target), settled: blend === null && !starting };
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
  playByEvent,
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
  playByEvent: ReadonlyMap<number, TimedPlay>;
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
  const xOfEvent = (eventId: number) => {
    const p = playByEvent.get(eventId);
    return p ? scale.xOf(p.time) : null;
  };
  /** On the strip, not parked at an edge by a zoom. */
  const inside = (x: number) => x > 0.5 && x < width - 0.5;

  const graph = useMemo(() => {
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
    return { chart: flowChart({ points, x0: 0, x1: width, height: Y.chartH, pad: 3, startDiff, minScale: Math.max(10, Math.ceil(largest / 5) * 5) }), points, startDiff };
  }, [flow, playByEvent, scale, width, zoomed]);
  const chart = graph?.chart ?? null;

  /** Whether the graph's line lies along a side's edge row all the way from x0 to x1: a score printed there would sit on it. */
  const lineOnEdge = (team: 1 | 2, x0: number, x1: number) =>
    !!graph &&
    lineAlongEdge(
      graph.points.map((p) => ({ x: p.x, y: graph.chart.yOf(p.diff) })),
      graph.chart.yOf(graph.startDiff),
      { team, x0, x1, height: Y.chartH },
    );

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
  // The words on the graph, in the order they give way. A run's score keeps the edge (a row in only for a team
  // name, or where the line itself lies along the edge). A timeout's mark goes a row in for a name, a score or an earlier mark: its hairline says where it is
  // either way. The largest lead's figure takes what is left over its peak, and is left out when nothing is: the
  // line under the track names it too.
  const pointsOfRun = new Map(runs.map((r) => [r.id, r.points]));
  const runScores = placeRunLabels(runs, { width, legend, lineOnEdge });
  const scoresOf = (team: 1 | 2) => runScores.filter((score) => score.team === team).map((score) => ({ team, x: score.x, width: RUN_LABEL_WIDTH, row: score.row }));
  const timeoutRows = new Map(placeTimeoutMarks(timeouts, { legend, words: [...scoresOf(1), ...scoresOf(2)] }).map((t) => [t.id, t.row]));
  const peakLabel =
    peak && peakX !== null
      ? placePeakLabel(peakX, {
          width,
          marks: [...scoresOf(peak.side), ...timeouts.filter((t) => t.team === peak.side).map((t) => ({ x: t.x, row: timeoutRows.get(t.id) ?? 0 }))],
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
          {/* A timeout's hairline through the graph, under everything else on it: the figures' rims break it, so it
              never strikes one through. Whether a timeout ended a run is read off the line and the run's stretch. */}
          {timeouts.map((t) => (
            <line key={t.id} data-strip="timeout-line" x1={t.x} x2={t.x} y1={0} y2={Y.chartH} strokeWidth="1" style={{ stroke: "var(--separator-strong)" }} />
          ))}
          {chart ? (
            <>
              {/* Runs: the stretch a team scored unanswered, shaded in its colour over the graph's whole height, as a
                  chart marks a period. Its score is printed further down, over the line. */}
              {runs.map((run) => (
                <rect
                  key={run.id}
                  data-strip="run"
                  data-id={run.id}
                  data-team={run.team}
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
              {/* Where the two sides' colours can't be told apart, the away side's runs are hatched as its area is. */}
              {tints.awayHatch &&
                runs.filter((run) => run.team === 2).map((run) => <rect key={run.id} data-strip="run-hatch" x={run.x0} y={0} width={run.x1 - run.x0} height={Y.chartH} rx="3" fill={`url(#${patternId}-away)`} />)}
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
              {runScores.map((score) => (
                <text
                  key={score.id}
                  data-strip="run-score"
                  x={score.x}
                  y={score.team === 1 ? 11 + score.row * 14 : Y.chartH - 4 - score.row * 14}
                  textAnchor="middle"
                  className="text-caption font-semibold nums"
                  style={{ fill: "var(--foreground)", ...HALO }}
                >
                  {pointsOfRun.get(score.id)}–0
                </text>
              ))}
            </>
          ) : (
            <text x={width / 2} y={Y.chartH / 2 + 4} textAnchor="middle" className="text-callout" style={{ fill: "var(--muted-foreground)" }}>
              This game has no score on record, so there is no score graph.
            </text>
          )}

          {/* Timeouts: play stopped, so a pause mark, on the calling side's edge (the officials' on the line), over
              its hairline. */}
          {timeouts.map((t) => {
            const row = timeoutRows.get(t.id) ?? 0;
            const y = t.team === 1 ? 1 + row * 13 : t.team === 2 ? Y.chartH - 9 - row * 13 : Y.chartH / 2 - 4;
            const bar = { fill: "var(--muted-foreground)" };
            return (
              <g key={t.id} data-strip="timeout" data-id={t.id}>
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
          // In the accent, so it never reads as part of the graph just above it.
          return <rect key={s.fromEventId} x={from} y={Y.stint} width={Math.max(2, to - from)} height={Y.stintH} rx="1.5" style={{ fill: "var(--primary)" }} />;
        })}

        {/* The plays the list shows, when the strip marks them: home above the lane's middle, away below, in one
            colour (one with no team on the middle). What kind of play each is, the list and the line under the track say. */}
        {listed &&
          timeline.plays.map((p) => {
            if (p.reach !== "in" || !listed.has(p.key)) return null;
            const side = p.event.eventTeam?.teamNumber ?? p.event.player?.teamNumber;
            const x = scale.xOf(p.time);
            if (!inside(x)) return null;
            return (
              <rect
                key={p.key}
                data-strip="play-mark"
                x={x - 0.75}
                // A play the feed gives to neither team stands on the lane's middle: what can be clicked can be seen.
                y={side === 1 ? LANE_MID - MARK_H - 0.5 : side === 2 ? LANE_MID + 0.5 : LANE_MID - MARK_H / 2}
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
  /** The play the line under the track describes: the mark or dot the pointer is on, else the play going on at that second. */
  play: TimedPlay | null;
  time: number;
  segment: ScaleSegment | null;
}

/** A run (by its first basket's event) or a timeout (by its event) on the strip. */
export interface StripLandmark {
  kind: "run" | "timeout";
  id: number;
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
  landmarkTime,
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
  /** A click on a run or a timeout (once for a double-click: its second click is the same visit). */
  onLandmark: (landmark: StripLandmark) => void;
  /** Where in the video a click on a run or a timeout goes; null with no footage. */
  landmarkTime: (landmark: StripLandmark) => number | null;
  /** The timeline moved the video, said once: a drag let go, a swipe come to rest, or a click on a second (a click on a play's mark is `onPlay`, on a run or a timeout `onLandmark`). */
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
  // A press on the track. `at` is what it is on, settled as the press is made: that is what a click will mean.
  // `held` is whether the press has taken hold of the playhead (the video waits under it, and follows a drag).
  const scrubRef = useRef<{ grabOffset: number; startX: number; at: Hover; moved: boolean; held: boolean; wasPlaying: boolean } | null>(null);
  // Where the pointer is over the track, for when the strip moves under it.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // A sideways swipe under way: it holds the playhead as a press does. `t` is where it has taken the video.
  const swipeRef = useRef<{ wasPlaying: boolean; t: number } | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLSpanElement | null>(null);
  // What was clicked last, where and when: the second click of a double-click is the same visit.
  const lastClick = useRef<{ what: string; x: number; at: number } | null>(null);
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

  // One quarter has the strip, or is on its way to. The marks and the quarter's own runs come with it, not once
  // the scale has come to rest: they would appear a moment after the quarter did.
  const zoomed = zoomPeriod !== null;
  // Settled on one quarter (not the whole game, and not on the way between the two): what the score graph is cut to.
  const zoomedIn = settled && zoomed;
  const playsShown = stripShowsPlays({ filtered, zoomed });
  // With one quarter on the strip, its plays only: the others are on their way out while the zoom moves, and a mark
  // for each of them would be the whole game's ticks for as long as it does.
  const listed = useMemo(
    () => (playsShown ? new Set(order.filter((i) => zoomPeriod === null || timeline.plays[i].event.period === zoomPeriod).map((i) => timeline.plays[i].key)) : null),
    [playsShown, order, timeline, zoomPeriod],
  );

  const playByEvent = useMemo(() => new Map(timeline.plays.map((p) => [p.event.eventId, p])), [timeline]);
  const playByKey = useMemo(() => new Map(timeline.plays.map((p) => [p.key, p])), [timeline]);
  // The playlist's plays on the strip: each a dot in the lane, and a play to click.
  const stripDots = useMemo(
    () =>
      timeline.plays.flatMap((p) => {
        if (p.reach !== "in" || !inTarget.has(p.key)) return [];
        const x = scale.xOf(p.time);
        return x > 0.5 && x < width - 0.5 ? [{ key: p.key, x }] : [];
      }),
    [timeline, inTarget, scale, width],
  );
  // The runs on the strip: all of them in one quarter, the largest at the whole game's width.
  const stripRuns = useMemo<StripRun[]>(() => {
    const shown = zoomed ? flow.runs : [...flow.runs].sort((a, b) => b.points - a.points).slice(0, RUNS_SHOWN);
    return runsOnStrip(
      shown.flatMap((run) => {
        const first = playByEvent.get(run.fromEventId);
        const last = playByEvent.get(run.toEventId);
        return first && last ? [{ id: run.fromEventId, team: run.team, points: run.points, x0: scale.xOf(first.time), x1: scale.xOf(last.time) }] : [];
      }),
      width,
    );
  }, [flow, playByEvent, scale, width, zoomed]);
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
        // With one quarter on the strip, its plays only: the quarter before ends at the left edge, and its last
        // play would be the nearest to a pointer there, with no mark and off the strip.
        if (zoomPeriod !== null && play.event.period !== zoomPeriod) continue;
        const distance = Math.abs(scale.xOf(play.time) - x);
        if (!best || distance < best.distance) best = { play, distance };
      }
      return best;
    },
    [order, scale, timeline, zoomPeriod],
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
      { timeouts: stripTimeouts, runs: stripRuns, play: near ? { key: near.play.key, distance: near.distance } : null, playsShown, dots: stripDots, snapPx: SNAP_PX },
    );
    let play: TimedPlay | null = null;
    if (target.kind === "play") play = playByKey.get(target.key) ?? null;
    // No footage: a click selects the listed play nearest it, as it always has.
    else if (!video) play = near?.play ?? null;
    else if (segment?.kind === "period") {
      // Of all the game's plays, not only the listed ones: the line is about this second, whatever the filter keeps.
      const i = playIndexAt(timeline.plays, timeline.byTime, time);
      play = i >= 0 ? timeline.plays[timeline.byTime[i]] : null;
    }
    return { x: at, target, play, time, segment };
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

  /** The press takes hold of the playhead: the video waits under it, and comes to the pointer when asked to. */
  function takeHold(s: NonNullable<typeof scrubRef.current>, x: number, toPointer: boolean) {
    if (!video) return;
    s.held = true;
    if (!video.paused) video.pause();
    setPressed(true);
    if (toPointer) scrubTo(x);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = localX(e.clientX);
    const at = hoverAt(x, localY(e.clientY));
    if (!video) {
      // Nothing to scrub: the release is a click that selects a play.
      scrubRef.current = { grabOffset: 0, startX: x, at, moved: false, held: false, wasPlaying: false };
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
    const s = { grabOffset: onPlayhead ? x - playheadX.get() : 0, startX: x, at, moved: false, held: false, wasPlaying: swipe ? swipe.wasPlaying : !video.paused };
    scrubRef.current = s;
    // On a second, the playhead comes to the pointer at once and the video with it. On a run, a timeout or a
    // play's mark the video is left alone until the click is made (it then goes to that place, once) or the
    // pointer is dragged (it then follows it). Taking it to the pointer first gave it two places to go to, the
    // second asked for while the first was under way, and WebKit now and then keeps the first: the timeout's row
    // came up in the list and the video played from the pointer.
    if (at.target.kind === "time") takeHold(s, x, !onPlayhead);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const x = localX(e.clientX);
    const y = localY(e.clientY);
    pointerRef.current = { x, y };
    const s = scrubRef.current;
    if (s) {
      if (!s.moved && Math.abs(x - s.startX) > DRAG_PX) {
        s.moved = true;
        // A drag from a run, a timeout or a mark: the playhead is taken up here.
        if (!s.held) takeHold(s, x, false);
      }
      if (video && s.moved) scrubTo(x);
    }
    setHover(hoverAt(x, y));
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
    // A click, on what the press was on. Both clicks of a double-click land here, on the same spot, before the
    // zoom: the second is the same visit, so it asks for nothing again and is not reported again.
    const at = s.at;
    const what = at.target.kind === "time" ? "time" : at.target.kind === "play" ? `play:${at.target.key}` : `${at.target.kind}:${at.target.id}`;
    const now = performance.now();
    const was = lastClick.current;
    const again = !!was && was.what === what && Math.abs(was.x - s.startX) <= DRAG_PX && now - was.at < 500;
    lastClick.current = { what, x: s.startX, at: now };
    if (at.target.kind === "run" || at.target.kind === "timeout") {
      if (!again) onLandmark({ kind: at.target.kind, id: at.target.id });
    } else if (at.play && (at.target.kind === "play" || !video)) {
      if (!again) onPlay(at.play);
    } else if (video) {
      if (!again) {
        onSeek(at.time);
        onScrubEnd?.("timeline");
      }
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

  // The strip moved under a still pointer (a zoom): the line under the track was about the strip as it stood. It
  // goes while the strip moves, and comes back about what is under the pointer now.
  useEffect(() => {
    if (scrubRef.current) return;
    const at = pointerRef.current;
    if (!settled) setHover(null);
    else if (at) setHover(hoverAt(at.x, at.y));
    // What is under the pointer is read once the strip has come to rest on the zoom asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, zoomPeriod]);

  // The readout is centred on the pointer and kept inside the strip, whatever it has to say.
  useLayoutEffect(() => {
    const el = readoutRef.current;
    if (!el || !hover) return;
    // Up to the zoom, which shares the row: the line never lies over it.
    const room = Math.max(0, width - (zoomRef.current ? zoomRef.current.offsetWidth + 8 : 0));
    el.style.maxWidth = `${room}px`;
    // In a column too narrow for the line even with the team's name cut short, the time in the video is left
    // out: the line ends on a whole word, not on one cut by its own edge.
    const time = el.querySelector<HTMLElement>('[data-readout="time"]');
    if (time) {
      time.hidden = false;
      if (el.scrollWidth > el.clientWidth) time.hidden = true;
    }
    const w = el.offsetWidth;
    el.style.transform = `translateX(${clamp(hover.x - w / 2, 0, Math.max(0, room - w))}px)`;
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
        name: t.teamNumber === 1 ? teams.home.name : t.teamNumber === 2 ? teams.away.name : "Officials",
        where: null,
        what: [periodLabel(t.period), t.clock].filter(Boolean).join(" · "),
        extra: t.scoreHome !== null && t.scoreAway !== null ? `${t.scoreHome}–${t.scoreAway}` : null,
      };
    }
    if (target.kind === "run") {
      const run = flow.runs.find((r) => r.fromEventId === target.id);
      if (!run) return null;
      const at = (eventId: number) => {
        const e = flow.order[flow.indexOf.get(eventId) ?? -1];
        return { period: e?.period ?? run.period, clock: e?.gameClockTime ? formatGameClock(e.gameClockTime) : null };
      };
      return {
        head: "Run",
        name: run.team === 1 ? teams.home.name : teams.away.name,
        where: `${run.points}–0`,
        what: runSpanText(at(run.fromEventId), at(run.toEventId)),
        extra: null,
      };
    }
    if (hover.segment && hover.segment.kind !== "period") {
      return { head: notchName(hover.segment), name: null, where: null, what: null, extra: null };
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
      name: null,
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

  /** The second in the video the line under the track gives: where a click would take it (a play starts from its run-up). */
  const hoverVideoTime = (h: Hover) => {
    if (h.target.kind === "play" && h.play) return h.play.start;
    if (h.target.kind === "run" || h.target.kind === "timeout") return landmarkTime({ kind: h.target.kind, id: h.target.id }) ?? h.time;
    return h.time;
  };
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
          if (scrubRef.current) return;
          pointerRef.current = null;
          setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        className="relative cursor-default touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection"
        style={{ height: Y.height }}
      >
        {width > 0 && (
          <StripDrawing
            scale={scale}
            timeline={timeline}
            playByEvent={playByEvent}
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
            className="pointer-events-none absolute top-full left-0 z-30 mt-1 flex h-6 max-w-full items-center gap-2 overflow-hidden rounded-md bg-material-popover px-2 text-subheadline whitespace-nowrap text-popover-foreground shadow-menu backdrop-blur-xl nums"
          >
            {/* Where there isn't room for it all, a team's name gives way first, then what else is true of the
                play, then the play's own words: the score, the quarter and clock and the time in the video stay whole. */}
            {tip.head && <span data-readout="head" className="shrink-0 font-semibold">{tip.head}</span>}
            {tip.name && <span data-readout="name" className="min-w-0 truncate text-muted-foreground">{tip.name}</span>}
            {tip.where && <span data-readout="where" className="shrink-0 text-muted-foreground">{tip.where}</span>}
            {tip.what && <span data-readout="what" className={tip.name ? "shrink-0" : "min-w-0 truncate"}>{tip.what}</span>}
            {tip.extra && <span data-readout="extra" className="min-w-0 shrink-[4] truncate text-muted-foreground">{tip.extra}</span>}
            {timeline.axis === "video" && video && hover.segment?.kind === "period" && (
              <span data-readout="time" className="shrink-0 text-muted-foreground">{formatVideoTime(hoverVideoTime(hover))} in the video</span>
            )}
          </div>
        )}
      </div>

      {/* Under the track, as a chart's legend is: the game in a line (on a first visit, how the timeline works, in the same place) and the zoom. */}
      <div className="mt-1 flex h-7 items-center gap-3">
        {(hint || facts.length > 0) && <p className="min-w-0 truncate text-subheadline text-muted-foreground nums">{hint ?? facts.join(" · ")}</p>}
        {timeline.bands.length > 1 && (
          <span ref={zoomRef} className="ml-auto shrink-0">
            <PopUpButton
              aria-label="Timeline zoom"
              size="sm"
              align="end"
              value={zoomPeriod === null ? "all" : String(zoomPeriod)}
              onValueChange={(v) => onZoom(v === "all" ? null : Number(v))}
              options={zoomOptions}
            />
          </span>
        )}
      </div>
    </section>
  );
}
