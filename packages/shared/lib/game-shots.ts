/**
 * A game's shots on one half court, for the Stats view's shot charts. The
 * feed places a shot at x, y in 0–100 court space along the length and the
 * width; teams shoot at opposite ends, so every shot is folded onto the
 * basket at the left (x 0–50) to be drawn and zoned the same way.
 */
import type { PlayByPlayEvent } from "../types/match";
import type { BoxCell } from "./game-box";

/** Court measures in metres (FIBA): 28 × 15, basket centre 1.575 from the baseline. */
export const COURT_LENGTH_M = 28;
export const COURT_WIDTH_M = 15;
export const BASKET_FROM_BASELINE_M = 1.575;
/**
 * Twos this close to the basket count as at the rim. Read off staging's 36
 * Genius games, 3,094 twos (2026-11-20): inside 2 m, 50–68 % went in and
 * about 80 % were lay-ups, dunks or tip-ins; from 2 m out, 31–38 % and mostly
 * jump shots. Lay-ups reach about 2.1 m. The feed's own areas don't draw this
 * line: its `inthepaint` has a median of 1.8 m, its `underbasket` 0.8 m.
 */
export const RIM_RADIUS_M = 2;

export type ShotZone = "rim" | "mid" | "three";

export const SHOT_ZONES: readonly ShotZone[] = ["rim", "mid", "three"];

function zoneOf(type: "2pt" | "3pt", x: number, y: number): ShotZone {
  if (type === "3pt") return "three";
  return metresFromBasket(x, y) <= RIM_RADIUS_M ? "rim" : "mid";
}

export interface ChartShot {
  eventId: number;
  personId: number | null;
  side: 1 | 2;
  made: boolean;
  /** On one half court, basket at the left: x 0–50, y 0–100. */
  x: number;
  y: number;
  zone: ShotZone;
}

/** Metres from the basket, for a position already on the left half. */
export function metresFromBasket(x: number, y: number): number {
  const dx = (x / 100) * COURT_LENGTH_M - BASKET_FROM_BASELINE_M;
  const dy = (y / 100 - 0.5) * COURT_WIDTH_M;
  return Math.hypot(dx, dy);
}

/** Positions on one half court, basket at the left (x 0–50). Null when the play isn't a field goal or has no position. */
export function chartShot(e: PlayByPlayEvent): ChartShot | null {
  if (e.type !== "2pt" && e.type !== "3pt") return null;
  if (typeof e.x !== "number" || typeof e.y !== "number") return null;
  const side = e.player?.teamNumber ?? e.eventTeam?.teamNumber;
  if (side !== 1 && side !== 2) return null;
  const far = e.x > 50;
  const x = far ? 100 - e.x : e.x;
  const y = far ? 100 - e.y : e.y;
  const zone = zoneOf(e.type, x, y);
  return { eventId: e.eventId, personId: e.player?.playerId ?? null, side, made: e.isSuccessful === 1, x, y, zone };
}

export function gameShots(events: readonly PlayByPlayEvent[]): { home: ChartShot[]; away: ChartShot[]; hasPositions: boolean } {
  const home: ChartShot[] = [];
  const away: ChartShot[] = [];
  for (const e of events) {
    const s = chartShot(e);
    if (s) (s.side === 1 ? home : away).push(s);
  }
  return { home, away, hasPositions: home.length + away.length > 0 };
}

/** Makes of attempts per zone, each with its shots. */
export function zoneCells(shots: readonly ChartShot[]): Record<ShotZone, BoxCell> {
  const out = {} as Record<ShotZone, BoxCell>;
  for (const zone of SHOT_ZONES) {
    const inZone = shots.filter((s) => s.zone === zone);
    out[zone] = { value: inZone.filter((s) => s.made).length, attempts: inZone.length, eventIds: inZone.map((s) => s.eventId) };
  }
  return out;
}
