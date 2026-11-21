/**
 * A team's players for its page (the design:
 * docs/superpowers/specs/2026-11-21-team-page-design.md, "Players"): its roster
 * joined to the league's season lines, and who does what, named by volume and
 * never by a percentage alone.
 */
import type { HostedSeasonPlayer } from "./hosted-stats";
import type { RosterMember } from "./league-players-db";
import type { SeasonLine } from "./stat-lines";

/** Games a player needs before being named. */
export const WHO_MIN_GAMES = 3;
/** Free throws a player needs before their percentage is named. */
export const WHO_MIN_FTA = 20;

export interface TeamPlayerRow {
  personId: string;
  name: string;
  number: string | null;
  line: SeasonLine;
  /** More than 1: the line includes games for another team this season. */
  stints: number;
}

/** Roster members who have a season line, most minutes first (then points). */
export function teamPlayers(roster: readonly RosterMember[], season: ReadonlyMap<string, HostedSeasonPlayer>): TeamPlayerRow[] {
  const rows: TeamPlayerRow[] = [];
  const seen = new Set<string>();
  for (const m of roster) {
    const p = season.get(m.personId);
    if (!p || seen.has(m.personId)) continue;
    seen.add(m.personId);
    rows.push({ personId: m.personId, name: p.name, number: m.shirtNumber, line: p.line, stints: p.stints });
  }
  return rows.sort((a, b) => (b.line.mpg ?? -1) - (a.line.mpg ?? -1) || b.line.ppg - a.line.ppg);
}

export interface Named {
  personId: string;
  name: string;
  value: number;
}

export interface WhoDoesWhat {
  /** Three-point attempts a game. */
  threes: Named[];
  /** Offensive rebounds a game. */
  offensiveGlass: Named[];
  /** Free throws attempted a game. */
  toTheLine: Named[];
  /** The best and worst free-throw percentage among those with enough attempts. */
  freeThrows: { best: Named; worst: Named } | null;
}

function topTwo(rows: readonly TeamPlayerRow[], pick: (l: SeasonLine) => number | null | undefined): Named[] {
  return rows
    .map((r) => ({ personId: r.personId, name: r.name, value: pick(r.line) ?? 0 }))
    .filter((n) => n.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
}

/** Who shoots threes, crashes the glass and gets to the line, among players with enough games. */
export function whoDoesWhat(rows: readonly TeamPlayerRow[]): WhoDoesWhat {
  const regulars = rows.filter((r) => r.line.gp >= WHO_MIN_GAMES);
  const shooters = regulars
    .filter((r) => r.line.ftPct !== null && (r.line.ftaPg ?? 0) * r.line.gp >= WHO_MIN_FTA)
    .map((r) => ({ personId: r.personId, name: r.name, value: r.line.ftPct! }))
    .sort((a, b) => b.value - a.value);
  return {
    threes: topTwo(regulars, (l) => (l.tpa === null ? null : l.tpa / l.gp)),
    offensiveGlass: topTwo(regulars, (l) => l.orpg),
    toTheLine: topTwo(regulars, (l) => l.ftaPg),
    freeThrows: shooters.length >= 2 ? { best: shooters[0], worst: shooters.at(-1)! } : null,
  };
}
