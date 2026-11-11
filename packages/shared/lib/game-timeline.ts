/**
 * A whole game laid along its video: every play at its second, the periods
 * as bands, which play is "now" at a given second, and the scale that draws
 * it all on a strip. Pure; the game view (docs/game-view.md) is built on it,
 * and the web's game view can be.
 *
 * Two axes. A synced game is placed in video seconds (computeVideoTime: its
 * period's own sync, or a cut's). A game with no sync, or no video on this
 * computer, is placed in wall-clock seconds from its first period's start,
 * so the overview still reads the same without footage.
 */
import type { GameMarks } from "../types/game-marks";
import type { PeriodMark, PlayByPlayEvent, SyncPoint } from "../types/match";
import { computeVideoTime } from "./clip-timing";
import { isBookkeepingEvent, periodLabel } from "./events";
import { periodSpans } from "./period-sync";

/**
 * How far ahead of the playhead a play already counts as "now". The feed
 * logs a play just after it happens, so a small lead keeps the list in step
 * with the picture. One constant, to tune on real footage.
 */
export const ACTIVE_LEAD_SECONDS = 0.3;

export type TimelineAxis = "video" | "wall";

/** A play placed on the axis. */
export interface TimedPlay {
  /** `${matchId}:${eventId}`, the editor's clip key. */
  key: string;
  event: PlayByPlayEvent;
  /** Seconds on the axis. */
  time: number;
  /** Where a click on the play starts playing: its pre-roll before it, never before 0. */
  start: number;
  /** Whether the play is inside the video file: "before" its start, "after" its end. */
  reach: "in" | "before" | "after";
}

export interface PeriodBand {
  period: number;
  label: string;
  start: number;
  end: number;
  /** The league's own start and end, not the period's first and last play. */
  exact: boolean;
}

export interface GameTimeline {
  axis: TimelineAxis;
  /** List order: period, time, eventId. */
  plays: TimedPlay[];
  /** Indices into `plays` by time, then eventId: what lookups search. */
  byTime: number[];
  bands: PeriodBand[];
  domain: { start: number; end: number };
  /** Plays with no usable time; they are not in `plays`. */
  unplaced: number;
  /** Plays that land before the file starts (a recording that began after tip-off). */
  beforeStart: number;
  /** Plays that land past the end of the file (a video that skips the breaks, quarters not set). */
  pastEnd: number;
  /** Two periods overlap on the video: a quarter's sync is wrong. */
  overlaps: boolean;
  /** A wall-clock moment of a period on the axis; null when it can't be placed. */
  timeOf: (realWorldTime: string | undefined | null, period: number) => number | null;
}

const msOf = (iso: string | undefined | null) => (iso ? new Date(iso).getTime() : Number.NaN);

/** The period bounds the timeline goes by: the sync's own marks first, the game's marks filling in. */
function mergedMarks(sync: SyncPoint | null | undefined, marks: GameMarks | null | undefined): Record<string, PeriodMark> {
  const out: Record<string, PeriodMark> = {};
  const keys = new Set([...Object.keys(sync?.marks ?? {}), ...Object.keys(marks?.periods ?? {})]);
  for (const key of keys) {
    const own = sync?.marks?.[key];
    const game = marks?.periods?.[key];
    const start = own?.startRealWorldTime ?? game?.startRealWorldTime;
    const end = own?.endRealWorldTime ?? game?.endRealWorldTime;
    const anchor = own?.anchor ?? (start ? { realWorldTime: start, kind: "period_start" as const, label: "" } : undefined);
    if (!anchor) continue;
    out[key] = {
      ...(start ? { startRealWorldTime: start } : {}),
      ...(end ? { endRealWorldTime: end } : {}),
      anchor,
    };
  }
  return out;
}

/**
 * Lays a game out. `durationSeconds` is the video file's length when known
 * (it bounds the axis and tells which plays fall outside the file);
 * `preRoll` is how far before a play a click on it starts.
 */
export function buildGameTimeline(input: {
  matchId: string;
  events: readonly PlayByPlayEvent[];
  sync?: SyncPoint | null;
  marks?: GameMarks | null;
  durationSeconds?: number | null;
  preRoll?: number;
}): GameTimeline {
  const { matchId, marks } = input;
  const preRoll = input.preRoll ?? 10;
  const duration = input.durationSeconds != null && input.durationSeconds > 0 ? input.durationSeconds : null;
  const events = input.events.filter((e) => e.type !== "timeout" && !isBookkeepingEvent(e));
  const sync = input.sync && Number.isFinite(msOf(input.sync.syncRealWorldTime)) ? input.sync : null;
  const periodMarks = mergedMarks(sync, marks);
  const spans = periodSpans(
    { syncVideoTime: sync?.syncVideoTime ?? 0, syncRealWorldTime: sync?.syncRealWorldTime ?? "", marks: periodMarks },
    events,
  );

  let timeOf: GameTimeline["timeOf"];
  if (sync) {
    timeOf = (realWorldTime, period) => computeVideoTime({ realWorldTime, period }, sync);
  } else {
    let origin = spans.length > 0 ? spans[0].start : Infinity;
    if (!Number.isFinite(origin)) {
      for (const e of events) {
        const t = msOf(e.realWorldTime);
        if (Number.isFinite(t)) origin = Math.min(origin, t);
      }
    }
    timeOf = (realWorldTime) => {
      const t = msOf(realWorldTime);
      return Number.isFinite(t) && Number.isFinite(origin) ? (t - origin) / 1000 : null;
    };
  }

  const plays: TimedPlay[] = [];
  let unplaced = 0;
  let beforeStart = 0;
  let pastEnd = 0;
  for (const event of events) {
    const time = timeOf(event.realWorldTime, event.period);
    if (time === null || !Number.isFinite(time)) {
      unplaced++;
      continue;
    }
    let reach: TimedPlay["reach"] = "in";
    if (sync && time < 0) {
      reach = "before";
      beforeStart++;
    } else if (sync && duration !== null && time > duration) {
      reach = "after";
      pastEnd++;
    }
    plays.push({ key: `${matchId}:${event.eventId}`, event, time, start: Math.max(0, time - preRoll), reach });
  }
  plays.sort((a, b) => a.event.period - b.event.period || a.time - b.time || a.event.eventId - b.event.eventId);

  const byTime = plays.map((_, i) => i);
  byTime.sort((a, b) => plays[a].time - plays[b].time || plays[a].event.eventId - plays[b].event.eventId);

  // The periods as bands, each widened to hold its own plays (the league's
  // period times and its plays' times can disagree by a few seconds).
  const bands: PeriodBand[] = [];
  for (const span of spans) {
    let start = timeOf(new Date(span.start).toISOString(), span.period);
    let end = timeOf(new Date(span.end).toISOString(), span.period);
    for (const p of plays) {
      if (p.event.period !== span.period) continue;
      start = start === null ? p.time : Math.min(start, p.time);
      end = end === null ? p.time : Math.max(end, p.time);
    }
    if (start === null || end === null) continue;
    const mark = periodMarks[String(span.period)];
    bands.push({
      period: span.period,
      label: periodLabel(span.period),
      start,
      end: Math.max(start, end),
      exact: !!(mark?.startRealWorldTime && mark?.endRealWorldTime),
    });
  }
  bands.sort((a, b) => a.period - b.period);
  const overlaps = bands.some((b, i) => i > 0 && b.start < bands[i - 1].end - 1);

  let domain: GameTimeline["domain"];
  if (sync) {
    let end = duration ?? 0;
    if (duration === null) {
      for (const b of bands) end = Math.max(end, b.end);
      for (const p of plays) end = Math.max(end, p.time);
    }
    domain = { start: 0, end: Math.max(end, 1) };
  } else {
    const start = bands.length > 0 ? Math.min(...bands.map((b) => b.start)) : 0;
    const end = bands.length > 0 ? Math.max(...bands.map((b) => b.end)) : 1;
    domain = { start, end: Math.max(end, start + 1) };
  }

  return { axis: sync ? "video" : "wall", plays, byTime, bands, domain, unplaced, beforeStart, pastEnd, overlaps, timeOf };
}

/** The time-ordered plays a filter keeps: what the lookups below search when a filter is on. */
export function visibleOrder(tl: Pick<GameTimeline, "plays" | "byTime">, keep: (play: TimedPlay) => boolean): number[] {
  return tl.byTime.filter((i) => keep(tl.plays[i]));
}

/**
 * Which play is "now" at second `t`: the position in `order` (indices into
 * `plays`, by time) of the latest play at or before `t + lead`. Of plays
 * logged in the same second it is the first (the shot, not its assist). −1
 * before the first play.
 */
export function playIndexAt(
  plays: readonly TimedPlay[],
  order: readonly number[],
  t: number,
  lead = ACTIVE_LEAD_SECONDS,
): number {
  let lo = 0;
  let hi = order.length - 1;
  let found = -1;
  const limit = t + lead;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (plays[order[mid]].time <= limit) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  while (found > 0 && plays[order[found - 1]].time === plays[order[found]].time) found--;
  return found;
}

/**
 * A play the coach clicked. Playback starts at its pre-roll, where the play
 * before it would still be "now": the pin holds the clicked play as current
 * until a later play has happened or the coach seeks back before it.
 */
export interface PlayPin {
  key: string;
  /** Where its playback started. */
  from: number;
  /** When the play itself happens. */
  time: number;
}

export function pinFor(play: TimedPlay): PlayPin {
  return { key: play.key, from: play.start, time: play.time };
}

/**
 * The current play at second `t`, honouring a pin: the position in `order`
 * (−1 for none) and the pin to keep (null once it has let go).
 */
export function activePlay(
  plays: readonly TimedPlay[],
  order: readonly number[],
  t: number,
  pin: PlayPin | null,
): { index: number; pin: PlayPin | null } {
  const at = playIndexAt(plays, order, t);
  if (pin && t >= pin.from - 1 && (at < 0 || plays[order[at]].time <= pin.time)) {
    const pinned = order.findIndex((i) => plays[i].key === pin.key);
    if (pinned >= 0) return { index: pinned, pin };
  }
  return { index: at, pin: null };
}

export type GamePhase = "before" | "live" | "break" | "after";

/**
 * Where second `t` falls in the game: before tip-off, in a period, in the
 * break after `period` (with `next` the period to come), or after the final
 * whistle. "live" with no period when the game has no bands at all.
 */
export function momentAt(
  tl: Pick<GameTimeline, "bands">,
  t: number,
): { phase: GamePhase; period: number | null; next: number | null } {
  const { bands } = tl;
  if (bands.length === 0) return { phase: "live", period: null, next: null };
  if (t < bands[0].start) return { phase: "before", period: null, next: bands[0].period };
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (t <= band.end) return { phase: "live", period: band.period, next: bands[i + 1]?.period ?? null };
    const following = bands[i + 1];
    if (following && t < following.start) return { phase: "break", period: band.period, next: following.period };
  }
  return { phase: "after", period: bands[bands.length - 1].period, next: null };
}

/** One stretch of the strip: a period, or the footage around the periods folded into a notch. */
export interface ScaleSegment {
  kind: "pre" | "period" | "break" | "post";
  /** The period itself, or the one a break follows. */
  period?: number;
  /** The period a break leads to. */
  next?: number;
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}

export interface GameScale {
  width: number;
  segments: ScaleSegment[];
  xOf: (t: number) => number;
  tOf: (x: number) => number;
}

/** A gap shorter than this is no break: the video skips it, and it draws as a divider. */
const BREAK_MIN_SECONDS = 1;

/**
 * The strip's x axis. Inside a period, equal distance is equal footage, so
 * the playhead moves at constant speed; each period's width is its share of
 * the game's playing time. What lies around the periods (warm-up, quarter
 * breaks, half-time, the time after the final whistle) is folded into notches
 * of a fixed width that still map to their footage, since nobody scouts a
 * quarter of the strip's worth of half-time. A break the video skips is a
 * hairline divider. `zoomPeriod` gives one period the whole width.
 */
export function gameScale(
  tl: Pick<GameTimeline, "bands" | "domain">,
  width: number,
  opts: { zoomPeriod?: number | null; edgeNotch?: number; breakNotch?: number; halfNotch?: number; divider?: number } = {},
): GameScale {
  const edgeNotch = opts.edgeNotch ?? 20;
  const breakNotch = opts.breakNotch ?? 12;
  const halfNotch = opts.halfNotch ?? 20;
  const divider = opts.divider ?? 2;

  // Bands made to follow one another, so the axis never runs backwards even
  // when a wrong quarter sync makes two overlap.
  const bands: PeriodBand[] = [];
  for (const b of tl.bands) {
    const start = bands.length > 0 ? Math.max(b.start, bands[bands.length - 1].end) : b.start;
    bands.push({ ...b, start, end: Math.max(b.end, start) });
  }

  const zoomed = opts.zoomPeriod != null ? bands.find((b) => b.period === opts.zoomPeriod) : undefined;
  const raw: Array<Omit<ScaleSegment, "x0" | "x1"> & { fixed?: number }> = [];
  if (zoomed) {
    raw.push({ kind: "period", period: zoomed.period, t0: zoomed.start, t1: zoomed.end });
  } else if (bands.length === 0) {
    raw.push({ kind: "period", t0: tl.domain.start, t1: tl.domain.end });
  } else {
    const first = bands[0];
    const last = bands[bands.length - 1];
    const from = Math.min(tl.domain.start, first.start);
    const to = Math.max(tl.domain.end, last.end);
    if (first.start - from > BREAK_MIN_SECONDS) raw.push({ kind: "pre", next: first.period, t0: from, t1: first.start, fixed: edgeNotch });
    bands.forEach((b, i) => {
      raw.push({ kind: "period", period: b.period, t0: b.start, t1: b.end });
      const following = bands[i + 1];
      if (!following) return;
      const real = following.start - b.end > BREAK_MIN_SECONDS;
      const half = b.period === 2 && following.period === 3;
      raw.push({
        kind: "break",
        period: b.period,
        next: following.period,
        t0: b.end,
        t1: following.start,
        fixed: real ? (half ? halfNotch : breakNotch) : divider,
      });
    });
    if (to - last.end > BREAK_MIN_SECONDS) raw.push({ kind: "post", period: last.period, t0: last.end, t1: to, fixed: edgeNotch });
  }

  // Notches never take more than 40% of the strip, however narrow it is.
  const fixedTotal = raw.reduce((sum, s) => sum + (s.fixed ?? 0), 0);
  const shrink = fixedTotal > width * 0.4 && fixedTotal > 0 ? (width * 0.4) / fixedTotal : 1;
  const flexible = Math.max(0, width - fixedTotal * shrink);
  const playing = raw.reduce((sum, s) => sum + (s.fixed === undefined ? s.t1 - s.t0 : 0), 0);
  const periodCount = raw.filter((s) => s.fixed === undefined).length;

  const segments: ScaleSegment[] = [];
  let x = 0;
  for (const s of raw) {
    const w =
      s.fixed !== undefined
        ? s.fixed * shrink
        : playing > 0
          ? (flexible * (s.t1 - s.t0)) / playing
          : flexible / Math.max(1, periodCount);
    segments.push({ kind: s.kind, period: s.period, next: s.next, t0: s.t0, t1: s.t1, x0: x, x1: x + w });
    x += w;
  }
  // Rounding must not leave a gap at the right edge.
  if (segments.length > 0) segments[segments.length - 1].x1 = width;

  const xOf = (t: number) => {
    if (segments.length === 0 || t <= segments[0].t0) return 0;
    for (const s of segments) {
      if (t > s.t1) continue;
      return s.t1 === s.t0 ? s.x0 : s.x0 + ((t - s.t0) / (s.t1 - s.t0)) * (s.x1 - s.x0);
    }
    return width;
  };
  const tOf = (px: number) => {
    if (segments.length === 0) return tl.domain.start;
    if (px <= 0) return segments[0].t0;
    for (const s of segments) {
      if (px > s.x1) continue;
      return s.x1 === s.x0 ? s.t0 : s.t0 + ((px - s.x0) / (s.x1 - s.x0)) * (s.t1 - s.t0);
    }
    return segments[segments.length - 1].t1;
  };
  return { width, segments, xOf, tOf };
}
