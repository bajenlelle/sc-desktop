/**
 * Every sentence the Stats view's season context writes (the design:
 * docs/superpowers/specs/2026-11-20-season-context-design.md, "The view").
 * Words, never signs or colours, so a lower-is-better factor reads the same
 * way as the rest.
 */
import type { FactorKey } from "./game-box";
import type { SeasonStanding } from "./season-payload";

/** A team's place in the table and its form, as the standings line reads them. */
export type TeamStanding = Pick<SeasonStanding, "position" | "won" | "lost" | "last5" | "streak">;

/** 1st, 2nd, 3rd, 4th, 11th, 21st, 111th. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** As the bars write it: points per possession and free-throw rate with two decimals, the rest in whole percent. */
export function formatFactor(key: FactorKey, v: number): string {
  return key === "ppp" || key === "ftRate" ? v.toFixed(2) : `${Math.round(v * 100)}%`;
}

const withRank = (value: string, rank: string | null) => (rank ? `${value} · ${rank}` : value);

/** Under tonight's number when the gap is real: "usually 52% · 4th". */
export function gapCaption(key: FactorKey, season: number, rank: number | null): string {
  return `usually ${withRank(formatFactor(key, season), rank === null ? null : ordinal(rank))}`;
}

const games = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;

/** The hover's first line: "Season, 11 other games: 52% · 4th of 11". */
export function seasonHoverLine(key: FactorKey, season: number, count: number, rank: number | null, teams: number, regular: boolean): string {
  const head = regular ? `Season, ${count} other ${count === 1 ? "game" : "games"}` : `Regular season, ${games(count)}`;
  return `${head}: ${withRank(formatFactor(key, season), rank === null ? null : `${ordinal(rank)} of ${teams}`)}`;
}

/** The hover's second line, what the opponent usually gives up: "Uppsala usually allows 51%". */
export function allowedLine(key: FactorKey, opponent: string, allowed: number): string {
  return key === "tovRate"
    ? `${opponent} usually forces turnovers on ${formatFactor(key, allowed)}`
    : `${opponent} usually allows ${formatFactor(key, allowed)}`;
}

/**
 * The line under the bars saying what the marks are. Under four games either
 * side gets "after 3 games" (and no captions); null when neither team has a
 * season to mark.
 */
export function seasonKey(homeGames: number, awayGames: number, regular: boolean): string | null {
  if (homeGames === 0 && awayGames === 0) return null;
  const same = homeGames === awayGames;
  if (!regular) {
    return same
      ? `Each line marks the team's regular season, from its ${games(homeGames)}.`
      : `Each line marks the team's regular season, from their games (${homeGames} and ${awayGames}).`;
  }
  if (Math.min(homeGames, awayGames) < 4) {
    return same
      ? `Each line marks the team's season after ${games(homeGames)}.`
      : `Each line marks the team's season after ${homeGames} and ${games(awayGames)}.`;
  }
  return same
    ? `Each line marks the team's season, from its other ${games(homeGames)}.`
    : `Each line marks the team's season, from their other games (${homeGames} and ${awayGames}).`;
}

/** "5th · 7–5 · won 4": place, record, and the current run when there is one. */
export function standingLine(s: TeamStanding): string {
  const parts = [ordinal(s.position), `${s.won}–${s.lost}`];
  const run = Number(s.streak);
  if (s.streak !== "" && Number.isFinite(run) && run !== 0) parts.push(run > 0 ? `won ${run}` : `lost ${-run}`);
  return parts.join(" · ");
}

/** The standings line's hover: "Today's table. Last five: L W W L W." */
export function lastFiveLine(last5: string): string {
  const form = last5.trim().split("").filter((c) => c.trim());
  return form.length ? `Today's table. Last five: ${form.join(" ")}.` : "Today's table.";
}

/** A points-from figure's hover: "usually 38 a game". */
export function usuallyPerGame(n: number): string {
  return `usually ${Math.round(n)} a game`;
}
