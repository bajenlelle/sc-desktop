/**
 * When a clip's drawings freeze the picture and where it plays slowly. The
 * players' rules (which drawing to hold now, the rate at a moment) and the
 * export's cut of a clip segment into pieces live here, pure, so every
 * surface keeps the same timing and the rules are tested once.
 */
import { HOLD_MAX, HOLD_MIN } from "./clip-drawing";

export type SlowRate = 0.5 | 0.25;
export const SLOW_RATES: readonly SlowRate[] = [0.5, 0.25];

/** A stretch of the clip played slowly: from `t` (the source video, absolute seconds) for `length` source seconds. */
export interface SlowSection {
  id: string;
  t: number;
  length: number;
  rate: SlowRate;
}

export const SLOW_DEFAULT_LENGTH = 2;
export const SLOW_MIN_LENGTH = 0.5;
export const SLOW_MAX_LENGTH = 6;
export const SLOW_STEP = 0.5;

/** A drawing in a player's own time base (the clip's file, or the source video in the editor). */
export interface HoldDrawing {
  id: string;
  at: number;
  hold: number;
}

/** A slow section in a player's own time base. */
export interface SlowSpan {
  at: number;
  length: number;
  rate: SlowRate;
}

/** How long after a drawing's frame a playing video still freezes on it; a scrub further past skips it. */
const FIRE_WINDOW = 0.75;
/** How far before a fired drawing the playhead must go back for it to fire again. */
const REARM_BEFORE = 0.3;
/** A paused playhead this close to a drawing's frame shows the drawing. */
const SHOW_TOLERANCE = 0.05;
/** Drawings this close to the segment's ends are left out (an export piece needs frames on both sides). */
const EDGE_MARGIN = 0.1;
/** A drawing closer than this after the previous one is dropped. */
const MIN_HOLD_GAP = 0.05;
/** Section boundaries this close to the ends, a freeze or the next section snap to it, so no piece is shorter. */
const SNAP = 0.1;
/** ffmpeg's between() includes its end, so a drawing's window ends this much before the first live frame. */
const WINDOW_END_GAP = 0.001;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The drawing to freeze on now, while playing: the earliest unfired one whose frame the playhead has just reached. */
export function holdDue<T extends HoldDrawing>(drawings: T[], now: number, fired: ReadonlySet<string>): T | null {
  let best: T | null = null;
  for (const d of drawings) {
    if (fired.has(d.id) || now < d.at || now >= d.at + FIRE_WINDOW) continue;
    if (!best || d.at < best.at) best = d;
  }
  return best;
}

/** The fired drawings that stay fired: one the playhead has gone back before fires again. */
export function rearm(drawings: HoldDrawing[], now: number, fired: ReadonlySet<string>): Set<string> {
  const next = new Set(fired);
  for (const d of drawings) if (now < d.at - REARM_BEFORE) next.delete(d.id);
  return next;
}

/**
 * The fired drawings once playback starts at `now`: a play from a drawing's
 * frame (or from within its window) goes on instead of holding it again,
 * since the viewer has just seen it held, or paused on it to look.
 */
export function firedOnPlay(drawings: HoldDrawing[], now: number, fired: ReadonlySet<string>): Set<string> {
  const next = new Set(fired);
  for (const d of drawings) if (now >= d.at - SHOW_TOLERANCE && now < d.at + FIRE_WINDOW) next.add(d.id);
  return next;
}

/** What to draw: the drawing being held, or, while paused, the one whose frame the playhead stands on. */
export function drawingToShow<T extends HoldDrawing>(drawings: T[], now: number, holdingId: string | null, paused: boolean): T | null {
  if (holdingId) return drawings.find((d) => d.id === holdingId) ?? null;
  if (!paused) return null;
  let best: T | null = null;
  for (const d of drawings) {
    const off = Math.abs(now - d.at);
    if (off <= SHOW_TOLERANCE && (!best || off < Math.abs(now - best.at))) best = d;
  }
  return best;
}

/** The rate factor at `now`: a section's rate inside it, 1 elsewhere. */
export function slowRateAt(slows: SlowSpan[], now: number): number {
  for (const s of slows) if (now >= s.at && now < s.at + s.length) return s.rate;
  return 1;
}

/** One piece of an exported clip segment: segment seconds [from, to) at `speed`, then its last frame held for `hold` seconds. */
export interface TimelinePiece {
  from: number;
  to: number;
  speed: 1 | SlowRate;
  hold: number;
  drawingId?: string;
}

/**
 * The export's clip segment [start, end] (source seconds) as pieces in
 * segment time: cut at every freeze and every slow section's boundary. Each
 * drawing's window is in the rendered segment's time, after the pieces and
 * holds before it. Without any effect, no pieces: the export stays as it was.
 */
export function segmentTimeline<D extends { id: string; t: number; hold: number }>(
  drawings: D[],
  slows: Pick<SlowSection, "t" | "length" | "rate">[],
  start: number,
  end: number,
): { pieces: TimelinePiece[]; windows: { drawing: D; from: number; to: number }[]; duration: number } {
  const D = r3(end - start);

  const holds: { at: number; hold: number; drawing: D }[] = [];
  const candidates = drawings
    .filter((d) => d.t > start + EDGE_MARGIN && d.t < end - EDGE_MARGIN)
    .map((d) => ({ at: r3(d.t - start), hold: r3(clamp(d.hold, HOLD_MIN, HOLD_MAX)), drawing: d }))
    .sort((x, y) => x.at - y.at);
  for (const h of candidates) {
    const prev = holds[holds.length - 1];
    if (prev && h.at - prev.at < MIN_HOLD_GAP) continue;
    holds.push(h);
  }

  const snap = (v: number) => {
    if (v < SNAP) return 0;
    if (D - v < SNAP) return D;
    for (const h of holds) if (Math.abs(v - h.at) < SNAP) return h.at;
    return r3(v);
  };
  const sections: { a: number; b: number; rate: SlowRate }[] = [];
  const raw = slows
    .map((s) => ({ a: Math.max(0, s.t - start), b: Math.min(D, s.t - start + s.length), rate: s.rate }))
    .filter((s) => s.b > s.a)
    .map((s) => ({ ...s, a: snap(s.a), b: snap(s.b) }))
    .sort((x, y) => x.a - y.a);
  for (const s of raw) {
    const prev = sections[sections.length - 1];
    let a = s.a;
    if (prev) {
      if (a < prev.b) a = prev.b;
      else if (a - prev.b < SNAP) prev.b = a;
    }
    if (s.b - a < SNAP) continue;
    sections.push({ a, b: s.b, rate: s.rate });
  }

  if (holds.length === 0 && sections.length === 0) return { pieces: [], windows: [], duration: D };

  const cuts = new Set<number>([0, D]);
  for (const h of holds) cuts.add(h.at);
  for (const s of sections) {
    cuts.add(s.a);
    cuts.add(s.b);
  }
  const xs = [...cuts].sort((p, q) => p - q);

  const pieces: TimelinePiece[] = [];
  const windows: { drawing: D; from: number; to: number }[] = [];
  let out = 0;
  for (let k = 0; k < xs.length - 1; k++) {
    const from = xs[k];
    const to = xs[k + 1];
    const speed = sections.find((s) => s.a <= from && to <= s.b)?.rate ?? 1;
    const h = holds.find((x) => x.at === to);
    pieces.push({ from, to, speed, hold: h?.hold ?? 0, ...(h ? { drawingId: h.drawing.id } : {}) });
    const played = r3((to - from) / speed);
    if (h) {
      const wFrom = r3(out + played);
      windows.push({ drawing: h.drawing, from: wFrom, to: r3(wFrom + h.hold - WINDOW_END_GAP) });
    }
    out = r3(out + played + (h?.hold ?? 0));
  }
  return { pieces, windows, duration: out };
}

/** How far a section may reach from its start: from the end of the one before (or the clip's start) to the start of the next (or the clip's end). */
export function slowRoom(sections: readonly SlowSection[], s: SlowSection, clipStart: number, clipEnd: number): { min: number; max: number } {
  const others = sections.filter((x) => x.id !== s.id);
  const min = Math.max(clipStart, ...others.filter((x) => x.t < s.t).map((x) => x.t + x.length));
  const max = Math.min(clipEnd, ...others.filter((x) => x.t > s.t).map((x) => x.t));
  return { min, max };
}

/**
 * "Slow motion" at the playhead `t0`, on a clip from `clipStart` to `clipEnd`:
 * the section under it (or starting just after, within half a second) opens,
 * seeking to its start when the playhead is before it; else a new half-speed
 * section starts here, as long as the room before the next section allows; with
 * too little room, the next section opens instead; null when there is none.
 */
export function slowAtPlayhead(
  sections: readonly SlowSection[],
  t0: number,
  clipStart: number,
  clipEnd: number,
  newId: () => string,
): { open: SlowSection; seekTo: number | null; created: boolean } | null {
  const sorted = [...sections].sort((a, b) => a.t - b.t);
  const hit = sorted.find((s) => t0 >= s.t - 0.5 && t0 < s.t + s.length);
  if (hit) return { open: hit, seekTo: t0 < hit.t ? hit.t : null, created: false };
  const t = Math.round(Math.min(Math.max(t0, clipStart), clipEnd - SLOW_MIN_LENGTH) * 1000) / 1000;
  const next = sorted.find((s) => s.t > t);
  const room = Math.floor((Math.min(clipEnd, next?.t ?? Infinity) - t) * 10) / 10;
  if (room < SLOW_MIN_LENGTH) return next ? { open: next, seekTo: null, created: false } : null;
  return { open: { id: newId(), t, length: Math.min(SLOW_DEFAULT_LENGTH, room), rate: 0.5 }, seekTo: null, created: true };
}

/** A section's new length, kept between the shortest and longest a section may be and short of the next one. */
export function clampSlowLength(sections: readonly SlowSection[], s: SlowSection, length: number, clipStart: number, clipEnd: number): number {
  const { max } = slowRoom(sections, s, clipStart, clipEnd);
  return Math.round(Math.max(SLOW_MIN_LENGTH, Math.min(length, SLOW_MAX_LENGTH, max - s.t)) * 1000) / 1000;
}

/** "Start here": the section moved to the playhead, as long as it stays between its neighbours, and shortened to fit. */
export function slowStartingAt(sections: readonly SlowSection[], s: SlowSection, at: number, clipStart: number, clipEnd: number): SlowSection {
  const { min, max } = slowRoom(sections, s, clipStart, clipEnd);
  const t = Math.round(Math.min(Math.max(at, min), max - SLOW_MIN_LENGTH) * 1000) / 1000;
  return { ...s, t, length: Math.min(s.length, Math.round((max - t) * 1000) / 1000) };
}
