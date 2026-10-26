/**
 * Season averages beside the player picker's roster, so a coach building a
 * scouting report can tick the opponent's leaders without opening a box score.
 *
 * Pure: the apps load the season pages (stats-card-data's loadSeasonPlayers)
 * and hand the parsed maps in. A roster spans several games, so each player's
 * line is looked up on the page of the competition their clips come from
 * (leaderCompetition); a player the page doesn't list, or whose games have
 * no hosted stats, keeps a null line and sorts last. leaders.ts is a
 * different thing: play-by-play leaders for the clip browser.
 */
import type { League } from "../types/league";
import type { PlaylistItem, StoredMatch } from "../types/match";
import { isClipItem } from "../types/match";
import type { HostedSeasonPlayer } from "./hosted-stats";
import type { PlayerChoice } from "./player-roster";
import type { SeasonLine } from "./stat-lines";
import { eventPeople, seasonOf } from "./stats-card-data";

export type LeaderStat = "ppg" | "rpg" | "apg" | "spg" | "bpg" | "tpPct";

/** The picker's columns, in order. */
export const LEADER_STATS: readonly { key: LeaderStat; label: string }[] = [
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "spg", label: "SPG" },
  { key: "bpg", label: "BPG" },
  { key: "tpPct", label: "3P%" },
];

/** Season three-point attempts needed before a 3P% ranks: 2 of 4 isn't a shooter. */
export const LEADER_MIN_3PA = 20;

export interface LeaderRow {
  player: PlayerChoice;
  /** The competition whose season page holds their line; null when no game of theirs has one. */
  competitionId: number | null;
  /** Null until the page is loaded, and when it doesn't list them. */
  line: SeasonLine | null;
}

/**
 * The competition whose season page has this player's line: the season of
 * the game their clips mostly come from (player.matchId), else the first of
 * the playlist's games (in order of first appearance in items) that lists
 * the player in its plays and has a season. Null when none does.
 */
export function leaderCompetition(
  player: PlayerChoice,
  items: readonly PlaylistItem[],
  matches: ReadonlyMap<string, StoredMatch>,
  leagues: League[],
): number | null {
  const own = matches.get(player.matchId);
  const ownSeason = own && seasonOf(own, leagues);
  if (ownSeason) return ownSeason.competitionId;

  const seen = new Set<string>([player.matchId]);
  for (const item of items) {
    if (!isClipItem(item) || seen.has(item.matchId)) continue;
    seen.add(item.matchId);
    const match = matches.get(item.matchId);
    const season = match && seasonOf(match, leagues);
    if (season && eventPeople(match).has(player.playerId)) return season.competitionId;
  }
  return null;
}

/** The roster joined with the loaded season pages, in roster order. */
export function leaderRows(
  roster: readonly PlayerChoice[],
  competitionOf: (p: PlayerChoice) => number | null,
  seasons: ReadonlyMap<number, ReadonlyMap<string, HostedSeasonPlayer>>,
): LeaderRow[] {
  return roster.map((player) => {
    const competitionId = competitionOf(player);
    const line = competitionId === null ? null : (seasons.get(competitionId)?.get(player.playerId)?.line ?? null);
    return { player, competitionId, line };
  });
}

export function leaderValue(row: LeaderRow, stat: LeaderStat): number | null {
  return row.line?.[stat] ?? null;
}

/** Highest first, players without a value last; ties by clips in the playlist, then name. A new array. */
export function rankBy(rows: readonly LeaderRow[], stat: LeaderStat): LeaderRow[] {
  return [...rows].sort((a, b) => {
    const av = leaderValue(a, stat);
    const bv = leaderValue(b, stat);
    if (av !== bv) {
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    }
    return b.player.clips - a.player.clips || a.player.name.localeCompare(b.player.name);
  });
}

/**
 * The first `n` of the ranking that have a value. A 3P% ranks only on enough
 * season attempts (opts.minAttempts, LEADER_MIN_3PA by default); the other
 * stats are per-game averages and need no floor.
 */
export function topN(rows: readonly LeaderRow[], stat: LeaderStat, n: number, opts: { minAttempts?: number } = {}): LeaderRow[] {
  const minAttempts = opts.minAttempts ?? LEADER_MIN_3PA;
  const eligible = rows.filter(
    (r) => leaderValue(r, stat) !== null && (stat !== "tpPct" || (r.line?.tpa ?? 0) >= minAttempts),
  );
  return rankBy(eligible, stat).slice(0, Math.max(0, n));
}

/**
 * One decimal, as the federation prints averages and percentages; an en dash
 * for no value. Every column prints the same way today; the stat is part of
 * the call so a column never has to know that.
 */
export function formatLeaderValue(stat: LeaderStat, value: number | null): string {
  return value === null ? "–" : value.toFixed(1);
}
