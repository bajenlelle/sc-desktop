/**
 * The team page's sentences (the design:
 * docs/superpowers/specs/2026-11-21-team-page-design.md). Dates arrive already
 * written by the page ("Sat 28 Nov"), so this stays free of locales.
 */
import { ordinal } from "./season-copy";

/**
 * The next or last meeting with the coach's team, from the coach's side. The
 * row is the page's team's: `home` is that team at home, and `score.own` its
 * points.
 */
export function meetingLine(m: { kind: "next" | "last"; home: boolean; score: { own: number; opp: number } | null }, when: string): string {
  if (m.kind === "next") return `You play them ${when}, ${m.home ? "away" : "at home"}.`;
  if (!m.score) return `You played them on ${when}.`;
  const { own: theirs, opp: yours } = m.score;
  return yours > theirs ? `You beat them ${yours}–${theirs} on ${when}.` : `You lost to them ${yours}–${theirs} on ${when}.`;
}

const games = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;

/** "12 games played · 3 in your library". */
export function coverageLine(played: number, inLibrary: number): string {
  return `${games(played)} played · ${inLibrary === 0 ? "none in your library yet" : `${inLibrary} in your library`}`;
}

/** A place in words, for a number's tooltip: "4th of 12 in the league", "4th of 14 in Södra". */
export function placeTooltip(place: number, of: number, where: string | null): string {
  return `${ordinal(place)} of ${of} in ${where ?? "the league"}`;
}

/** "78 possessions a game, 2nd fastest."; place 1 is the fastest. */
export function paceLine(pace: number, place: number | null, of: number): string {
  const head = `${Math.round(pace)} possessions a game`;
  if (place === null) return `${head}.`;
  if (place === 1) return `${head}, the fastest.`;
  if (place === of) return `${head}, the slowest.`;
  return `${head}, ${ordinal(place)} fastest.`;
}
