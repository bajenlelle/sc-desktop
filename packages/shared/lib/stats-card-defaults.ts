/**
 * Where a new stats card starts in a playlist editor, and when the editor
 * suggests one: the desktop's defaultStatsCard and its "Show your stats in
 * the video" hint (pages/playlists.tsx), pure, so the web editor starts its
 * cards the same way. The numbers themselves come from stats-card-data.
 */
import type { PlayByPlayEvent } from "../types/match";
import { pickDefaultPlayer } from "./stats-card";

/** A clip from a game with stats, with its play. */
export interface StatsClip {
  matchId: string;
  event: PlayByPlayEvent;
}

export interface StatsCardTarget {
  /** The game the card's numbers are read from first. */
  matchId: string;
  /** Whose numbers the card shows (a Genius or Profixio personId). */
  playerId: string;
  /**
   * The clip events a card's player is ranked from (most clips wins), the
   * chosen player's first, so a tie goes to them.
   */
  events: PlayByPlayEvent[];
  /** Season averages first when the clips span several games, unless a clip chose the card. */
  defaultScope: "game" | "season";
}

const personOf = (e: PlayByPlayEvent): string | null => (e.player ? String(e.player.playerId) : null);

/**
 * A new card's player and game. From a clip (its row's "Insert stats card
 * above"): that clip's player, in its game. Otherwise the player with the
 * most clips (a tie goes to the playing clip's player), in the game they
 * have the most clips in; with clips from several games the card starts on
 * the season. Null when no clip has a player.
 */
export function statsCardTarget(
  clips: readonly StatsClip[],
  opts: { anchor?: StatsClip | null; activePlayerId?: string | null } = {},
): StatsCardTarget | null {
  const anchorPerson = opts.anchor ? personOf(opts.anchor.event) : null;
  if (opts.anchor && anchorPerson) {
    return { matchId: opts.anchor.matchId, playerId: anchorPerson, events: [opts.anchor.event], defaultScope: "game" };
  }
  const top = pickDefaultPlayer(
    clips.map((c) => c.event),
    { activePlayerId: opts.activePlayerId ?? null },
  );
  if (!top) return null;
  const theirs = clips.filter((c) => personOf(c.event) === top.playerId);
  const counts = new Map<string, number>();
  for (const c of theirs) counts.set(c.matchId, (counts.get(c.matchId) ?? 0) + 1);
  // Most clips; a tie keeps the game that came first.
  let matchId: string | null = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      matchId = id;
      best = n;
    }
  }
  if (matchId === null) return null;
  const others = clips.filter((c) => personOf(c.event) !== top.playerId);
  return {
    matchId,
    playerId: top.playerId,
    events: [...theirs, ...others].map((c) => c.event),
    defaultScope: new Set(clips.map((c) => c.matchId)).size > 1 ? "season" : "game",
  };
}

/** Clips one player needs before the editor suggests a card of their stats. */
export const STATS_SUGGESTION_MIN_CLIPS = 3;

export interface StatsCardSuggestion {
  playerId: string;
  /** The clips span several games: the card would show season averages. */
  severalGames: boolean;
  /** The one game the suggestion's numbers line is read from; null with several games. */
  lineMatchId: string | null;
}

/**
 * The editor's one-time "Show your stats in the video": in a personal space
 * (a player's own highlights), for a playlist with no stats card yet, once
 * one player has at least three clips from games with stats. Dismissed per
 * playlist.
 */
export function statsCardSuggestion(
  clips: readonly StatsClip[],
  opts: { personal: boolean; dismissed: boolean; hasStatsCard: boolean },
): StatsCardSuggestion | null {
  if (!opts.personal || opts.dismissed || opts.hasStatsCard) return null;
  const top = pickDefaultPlayer(clips.map((c) => c.event));
  if (!top || top.clips < STATS_SUGGESTION_MIN_CLIPS) return null;
  const severalGames = new Set(clips.map((c) => c.matchId)).size > 1;
  const theirGames = new Set(clips.filter((c) => personOf(c.event) === top.playerId).map((c) => c.matchId));
  return {
    playerId: top.playerId,
    severalGames,
    lineMatchId: !severalGames && theirGames.size === 1 ? [...theirGames][0] : null,
  };
}
