/**
 * Which game the desktop's Add clips sheet shows, and how its Game list
 * reads. A coach adds clips in rounds, one player at a time from the same
 * game, so the sheet starts on the game they were in rather than the newest
 * import; the list puts the playlist's own games on top (a split menu: the
 * few likely picks first, the whole list under them) and can be searched.
 * Pure: the sheet and the tests share it.
 */
import type { PlaylistClipItem, PlaylistItem, StoredMatch } from "../types/match";
import { isClipItem } from "../types/match";
import { foldForSearch } from "./league-teams";

export type BrowserGame = Pick<StoredMatch, "id" | "title" | "date" | "homeTeam" | "awayTeam" | "events">;

/** The most games the "In this playlist" group lists: a split menu helps only while it stays short. */
export const IN_PLAYLIST_MAX = 4;

export type StartSource = "remembered" | "most_clips" | "newest";

/** Clips per game in the playlist. */
function clipsPerGame(items: readonly PlaylistItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) if (isClipItem(item)) counts.set(item.matchId, (counts.get(item.matchId) ?? 0) + 1);
  return counts;
}

/** Latest game first; the same day by title. */
const byDateDesc = (a: BrowserGame, b: BrowserGame) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title);

/**
 * The game to start on: the one last browsed for this playlist while it
 * exists, else the one with the most clips in the playlist (the later game on
 * a tie), else the latest game played.
 */
export function startGame(matches: readonly BrowserGame[], items: readonly PlaylistItem[], remembered: string | null): { id: string | null; source: StartSource } {
  if (remembered !== null && matches.some((m) => m.id === remembered)) return { id: remembered, source: "remembered" };
  const counts = clipsPerGame(items);
  const sorted = [...matches].sort(byDateDesc);
  let best: BrowserGame | null = null;
  for (const m of sorted) {
    const n = counts.get(m.id) ?? 0;
    if (n > 0 && (best === null || n > (counts.get(best.id) ?? 0))) best = m;
  }
  if (best) return { id: best.id, source: "most_clips" };
  return { id: sorted[0]?.id ?? null, source: "newest" };
}

/** Every word of the query in the game's title or its teams' names, case and accents aside. */
function matchesQuery(m: BrowserGame, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const haystack = foldForSearch(`${m.title} ${m.homeTeam.name} ${m.awayTeam.name}`);
  return words.every((w) => haystack.includes(w));
}

/**
 * The Game list: the playlist's games with their clip counts (most first, at
 * most IN_PLAYLIST_MAX), then every game by date, latest first. The top
 * group's games stay in the full list too, so it is always complete.
 */
export function gameGroups(
  matches: readonly BrowserGame[],
  items: readonly PlaylistItem[],
  query: string,
): { inPlaylist: { match: BrowserGame; clips: number }[]; all: BrowserGame[] } {
  const words = foldForSearch(query).split(" ").filter(Boolean);
  const all = matches.filter((m) => matchesQuery(m, words)).sort(byDateDesc);
  const counts = clipsPerGame(items);
  const inPlaylist = all
    .filter((m) => (counts.get(m.id) ?? 0) > 0)
    .map((match) => ({ match, clips: counts.get(match.id)! }))
    .sort((a, b) => b.clips - a.clips || byDateDesc(a.match, b.match))
    .slice(0, IN_PLAYLIST_MAX);
  return { inPlaylist, all };
}

/**
 * The ticked clips (`matchId:eventId`) as playlist items in game order: the
 * games as listed, each game's plays in their order. Keys that aren't a play
 * of a listed game are dropped.
 */
export function orderForAdd(keys: readonly string[], matches: readonly BrowserGame[]): PlaylistClipItem[] {
  const wanted = new Set(keys);
  const out: PlaylistClipItem[] = [];
  for (const m of matches) {
    for (const e of m.events) {
      if (wanted.has(`${m.id}:${e.eventId}`)) out.push({ type: "clip", matchId: m.id, eventId: e.eventId });
    }
  }
  return out;
}
