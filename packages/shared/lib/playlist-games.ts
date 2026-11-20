/**
 * The games a playlist's clips come from, for the editor's subtitle: one game
 * is named and opens it; several are counted and listed in a menu. Ordered by
 * where each game's first clip stands in the playlist, so the menu reads as
 * the playlist does. A game the coach's library doesn't hold (deleted, or in
 * another space) is left out: there is nothing to open.
 */
import { isClipItem, type PlaylistItem } from "../types/match";

export interface PlaylistGame {
  id: string;
  title: string;
  /** Clips from this game in the playlist. */
  clips: number;
}

export function playlistGames(
  items: readonly PlaylistItem[],
  lookup: { get(id: string): { title: string } | undefined },
): PlaylistGame[] {
  const byId = new Map<string, PlaylistGame>();
  for (const item of items) {
    if (!isClipItem(item)) continue;
    const known = byId.get(item.matchId);
    if (known) {
      known.clips += 1;
      continue;
    }
    const match = lookup.get(item.matchId);
    if (!match) continue;
    byId.set(item.matchId, { id: item.matchId, title: match.title || "Game", clips: 1 });
  }
  return [...byId.values()];
}
