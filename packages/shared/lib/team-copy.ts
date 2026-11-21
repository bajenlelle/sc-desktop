/**
 * The team page's sentences (the design:
 * docs/superpowers/specs/2026-11-21-team-page-design.md). Dates arrive already
 * written by the page ("Sat 28 Nov"), so this stays free of locales.
 */
import { ordinal } from "./season-copy";
import type { KeyStat, PlaysPick, PlaysSide, StatCount } from "./team-video";

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

/** "12 games played · 3 imported". */
export function coverageLine(played: number, inLibrary: number): string {
  return `${games(played)} played · ${inLibrary === 0 ? "none imported yet" : `${inLibrary} imported`}`;
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A key's line from the coach's games: "In your 3 games: 41 turnovers". */
export function videoKeyLine(stat: KeyStat, side: PlaysSide, c: StatCount, games: number): string {
  const prefix = games === 1 ? "In your game: " : `In your ${games} games: `;
  const against = side === "without" ? " against them" : "";
  switch (stat) {
    case "threes":
      return `${prefix}${c.made ?? 0} of ${c.count} ${c.count === 1 ? "three" : "threes"}${against}`;
    case "oreb":
      return `${prefix}${plural(c.count, "offensive rebound", "offensive rebounds")}${against}`;
    case "tov":
      return `${prefix}${side === "without" ? plural(c.count, "turnover forced", "turnovers forced") : plural(c.count, "turnover", "turnovers")}`;
  }
}

const STAT_NAMES: Record<KeyStat, Record<PlaysSide, string>> = {
  threes: { with: "Threes", without: "Threes against them" },
  oreb: { with: "Offensive rebounds", without: "Offensive rebounds against them" },
  tov: { with: "Turnovers", without: "Turnovers forced" },
};
const ZONE_NAMES = { rim: "At the rim", mid: "Mid-range", three: "Threes" } as const;

/** The picked plays' pill in Plays: "Turnovers · 41", "At the rim · 58 of 102". */
export function pickLabel(pick: PlaysPick, count: number, made: number | null): string {
  const n = made === null ? `${count}` : `${made} of ${count}`;
  if (pick.kind === "stat") return `${STAT_NAMES[pick.stat][pick.side]} · ${pick.stat === "threes" ? n : count}`;
  if (pick.kind === "zone") return `${ZONE_NAMES[pick.zone]} · ${n}`;
  return `${pick.name} · ${count}`;
}

/** Some of the coach's games of a team couldn't be read: "Couldn't read the plays of 1 of your 3 games." */
export function failedReadsLine(failed: number, of: number): string {
  if (of === 1) return "Couldn't read the plays of your game.";
  if (failed === of) return `Couldn't read the plays of your ${of} games.`;
  return `Couldn't read the plays of ${failed} of your ${of} games.`;
}

/** A player's games in the coach's library, in the Players table. */
export function playersCell(games: number): string {
  return plural(games, "game", "games");
}
