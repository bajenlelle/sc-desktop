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
import { playerKey } from "./clip-filters";

export type BrowserGame = Pick<StoredMatch, "id" | "title" | "date" | "homeTeam" | "awayTeam" | "events">;

/** The most games the "In this playlist" group lists: a split menu helps only while it stays short. */
export const IN_PLAYLIST_MAX = 4;

export type StartSource = "preferred" | "remembered" | "most_clips" | "newest";

/** Clips per game in the playlist. */
function clipsPerGame(items: readonly PlaylistItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) if (isClipItem(item)) counts.set(item.matchId, (counts.get(item.matchId) ?? 0) + 1);
  return counts;
}

/** Latest game first; the same day by title. */
const byDateDesc = (a: BrowserGame, b: BrowserGame) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title);

/**
 * The game to start on: the one the coach came here from (a game page's
 * "Build a playlist") while it exists, else the one last browsed for this
 * playlist, else the one with the most clips in the playlist (the later game
 * on a tie), else the latest game played.
 */
export function startGame(
  matches: readonly BrowserGame[],
  items: readonly PlaylistItem[],
  remembered: string | null,
  preferred: string | null = null,
): { id: string | null; source: StartSource } {
  if (preferred !== null && matches.some((m) => m.id === preferred)) return { id: preferred, source: "preferred" };
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

/** The most games the sheet searches at once: each is a fetch of its plays, and the list stays readable. */
export const MAX_BROWSER_GAMES = 10;

/** How many games "Last 5 games" picks. */
export const RECENT_GAMES = 5;

/**
 * The games to start on: the one the coach came here from alone, while it
 * exists; else the games last browsed for this playlist that still exist, in
 * that order; else startGame's game (most clips, else the latest played).
 */
export function startGames(
  matches: readonly BrowserGame[],
  items: readonly PlaylistItem[],
  remembered: readonly string[],
  preferred: string | null = null,
): { ids: string[]; source: StartSource } {
  if (preferred !== null && matches.some((m) => m.id === preferred)) return { ids: [preferred], source: "preferred" };
  const kept = remembered.filter((id) => matches.some((m) => m.id === id));
  if (kept.length > 0) return { ids: kept, source: "remembered" };
  const s = startGame(matches, items, null);
  return { ids: s.id !== null ? [s.id] : [], source: s.source };
}

/** The chosen games with `id` ticked or unticked; the last game can't be unticked, and none is added past `max`. */
export function toggleGame(ids: readonly string[], id: string, max: number = MAX_BROWSER_GAMES): string[] {
  if (ids.includes(id)) return ids.length === 1 ? [...ids] : ids.filter((x) => x !== id);
  if (ids.length >= max) return [...ids];
  return [...ids, id];
}

/** The latest `n` games played, latest first. */
export function latestGames(matches: readonly BrowserGame[], n: number = RECENT_GAMES): string[] {
  return [...matches].sort(byDateDesc).slice(0, n).map((m) => m.id);
}

/** A team's latest `n` games, home or away, latest first; the name is compared case and accents aside. */
export function teamGames(matches: readonly BrowserGame[], team: string, n: number = RECENT_GAMES): string[] {
  const wanted = foldForSearch(team);
  return matches
    .filter((m) => foldForSearch(m.homeTeam.name) === wanted || foldForSearch(m.awayTeam.name) === wanted)
    .sort(byDateDesc)
    .slice(0, n)
    .map((m) => m.id);
}

/** The team (as the game row names it) of the player's latest game in these games; null if no loaded play has them. */
export function playerTeam(matches: readonly BrowserGame[], key: string): string | null {
  for (const m of [...matches].sort(byDateDesc)) {
    const e = m.events.find((x) => playerKey(x) === key);
    if (e?.player) return e.player.teamNumber === 2 ? m.awayTeam.name : m.homeTeam.name;
  }
  return null;
}
