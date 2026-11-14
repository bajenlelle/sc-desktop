/**
 * The game strip's rules (the desktop's timeline under the footage): when it
 * draws a mark per play, where the words on its graph go, and what the
 * pointer is on. Pure: positions come in as the strip's own pixels.
 *
 * The strip is an overview, and the list beside it already names every play.
 * So it shows the game's landmarks (quarters, the score, runs, timeouts) and
 * brings the plays out only when they answer a question: a filter is on, or
 * the coach has zoomed into one quarter, where there is room to read them.
 */

/** Whether the strip draws a mark for each listed play. */
export function stripShowsPlays(state: { filtered: boolean; zoomed: boolean }): boolean {
  return state.filtered || state.zoomed;
}

export interface StripLegend {
  /** Where the team names start on the strip. */
  x: number;
  /** How far each side's name reaches from there, swatch included; 0 with no name. */
  home: number;
  away: number;
}

export interface StripRun {
  id: number;
  team: 1 | 2;
  points: number;
  x0: number;
  x1: number;
}

export interface PlacedRunLabel {
  id: number;
  /** The middle of the printed score. */
  x: number;
  /** 0 on the graph's edge (the running side's), 1 a row further in. */
  row: 0 | 1;
}

/** The room a run's score ("17–0") takes on the graph, air included. */
const RUN_LABEL_WIDTH = 34;
/** The room a timeout's mark takes. */
const TIMEOUT_MARK_WIDTH = 11;
/** The room the largest lead's figure ("+19") takes. */
const PEAK_LABEL_WIDTH = 28;

/** Whether something `size` wide around `x` stands on the side's team name. */
function onLegend(x: number, size: number, legend: StripLegend, team: 1 | 2): boolean {
  const reach = team === 1 ? legend.home : legend.away;
  return reach > 0 && x - size / 2 < legend.x + reach && x + size / 2 > legend.x;
}

/**
 * Where each run's score is printed: over the middle of its stretch, kept
 * inside the strip, on the running side's edge. A score that would stand on
 * its side's team name goes a row further in. Of two that would stand on each
 * other, the larger run keeps its score; the other is still drawn as a
 * stretch and named by the pointer. A run off the strip prints nothing.
 */
export function placeRunLabels(runs: readonly StripRun[], opts: { width: number; legend: StripLegend; labelWidth?: number }): PlacedRunLabel[] {
  const size = opts.labelWidth ?? RUN_LABEL_WIDTH;
  const placed: (PlacedRunLabel & { team: 1 | 2 })[] = [];
  const bySize = runs.filter((r) => r.x1 > 0 && r.x0 < opts.width).sort((a, b) => b.points - a.points || a.x0 - b.x0);
  for (const run of bySize) {
    const x = Math.min(Math.max((run.x0 + run.x1) / 2, size / 2), opts.width - size / 2);
    const row = onLegend(x, size, opts.legend, run.team) ? 1 : 0;
    if (placed.some((p) => p.team === run.team && p.row === row && Math.abs(p.x - x) < size)) continue;
    placed.push({ id: run.id, x, row, team: run.team });
  }
  return placed.sort((a, b) => a.x - b.x || a.id - b.id).map(({ id, x, row }) => ({ id, x, row }));
}

export interface StripTimeout {
  id: number;
  /** 0 for the officials'. */
  team: 0 | 1 | 2;
  x: number;
}

/**
 * Which row each timeout's mark takes: its team's edge of the graph, or a
 * row further in where that side's team name stands. The officials' is on
 * the middle line, where no name is.
 */
export function placeTimeoutMarks(timeouts: readonly StripTimeout[], opts: { legend: StripLegend; markWidth?: number }): { id: number; row: 0 | 1 }[] {
  const size = opts.markWidth ?? TIMEOUT_MARK_WIDTH;
  return timeouts.map((t) => ({ id: t.id, row: t.team !== 0 && onLegend(t.x, size, opts.legend, t.team) ? 1 : 0 }));
}

/**
 * Where the largest lead's figure is printed: over its peak, kept inside the
 * strip, just inside the leading side's area. A timeout's mark of that side
 * stands on the same edge, so under one the figure goes a row further in. It
 * stays over the peak, where the area is tallest: moved aside it would land
 * on the line. A mark that is itself a row in (it made room for a team name)
 * leaves the first row free.
 */
export function placePeakLabel(
  x: number,
  opts: { width: number; marks: readonly { x: number; row: 0 | 1 }[]; labelWidth?: number; markWidth?: number },
): { x: number; row: 0 | 1 } {
  const half = (opts.labelWidth ?? PEAK_LABEL_WIDTH) / 2;
  // How near a mark's middle the figure's middle may come: half of each, and 2 px of air.
  const reach = half + (opts.markWidth ?? TIMEOUT_MARK_WIDTH) / 2 + 2;
  const over = Math.min(Math.max(x, half), opts.width - half);
  return { x: over, row: opts.marks.some((mark) => mark.row === 0 && Math.abs(mark.x - over) < reach) ? 1 : 0 };
}

/** The strip's rows: the quarter bands, the score graph, and the lane under it where the play marks are. */
export type StripZone = "band" | "chart" | "lane";

export type StripTarget = { kind: "timeout"; id: number } | { kind: "play"; key: string } | { kind: "run"; id: number } | { kind: "time" };

/**
 * What the pointer is on, which is what a click means and what the line
 * under the track names. On the graph: a timeout within reach, else the run
 * whose stretch it is in. In the lane: the play mark it is on, while marks
 * are shown. Anything else is the second under the pointer: with no marks on
 * the strip a click never jumps to a play nobody can see.
 */
export function stripTargetAt(
  point: { x: number; zone: StripZone },
  on: {
    timeouts: readonly { id: number; x: number }[];
    runs: readonly { id: number; x0: number; x1: number }[];
    /** The listed play nearest the pointer, and how far away it is. */
    play: { key: string; distance: number } | null;
    playsShown: boolean;
    snapPx?: number;
    timeoutPx?: number;
  },
): StripTarget {
  if (point.zone === "chart") {
    const reach = on.timeoutPx ?? 6;
    let nearest: { id: number; distance: number } | null = null;
    for (const t of on.timeouts) {
      const distance = Math.abs(t.x - point.x);
      if (distance <= reach && (!nearest || distance < nearest.distance)) nearest = { id: t.id, distance };
    }
    if (nearest) return { kind: "timeout", id: nearest.id };
    const run = on.runs.find((r) => point.x >= r.x0 - 1 && point.x <= r.x1 + 1);
    if (run) return { kind: "run", id: run.id };
  }
  if (point.zone === "lane" && on.playsShown && on.play && on.play.distance <= (on.snapPx ?? 4)) return { kind: "play", key: on.play.key };
  return { kind: "time" };
}
