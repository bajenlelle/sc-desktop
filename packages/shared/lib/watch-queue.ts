/**
 * What a recipient watches when they open a shared playlist, and how their
 * progress through it is counted. Pure, so the web watch view's rules are
 * tested here: which items make the list, where Resume starts, what counts
 * as watched, and that a clip is recorded as watched once.
 *
 * Clips are identified by game and event together: event ids number the
 * plays within one game, so two games in one playlist can share them.
 */
import type { Playlist, PlayByPlayEvent, PlaylistTextCard } from "../types/match";
import { isClipItem } from "../types/match";
import { clipViewKey } from "./clip-views-db";
import { playableClips } from "./playlist-feed";

/** One item a recipient can watch: a clip's own uploaded file, or a timed text card. */
export type WatchItem =
  | { kind: "clip"; key: string; event: PlayByPlayEvent; matchId: string; r2Url: string; note?: string }
  | { kind: "text"; key: string; card: PlaylistTextCard };

/** The key a clip goes by in the watch list. */
export function clipKey(matchId: string, eventId: number): string {
  return `${matchId}:${eventId}`;
}

/**
 * The playlist's items in order, as the recipient sees them. Clips that are
 * not uploaded yet are left out (a row they can never play only reads as
 * broken), and so are clips whose play the game data no longer has.
 */
export function buildWatchItems(playlist: Playlist, eventByKey: Map<string, PlayByPlayEvent>): WatchItem[] {
  const items: WatchItem[] = [];
  for (const item of playlist.items) {
    if (isClipItem(item)) {
      if (!item.r2Url) continue;
      const key = clipKey(item.matchId, item.eventId);
      const event = eventByKey.get(key);
      if (!event) continue;
      items.push({ kind: "clip", key, event, matchId: item.matchId, r2Url: item.r2Url, note: item.note });
    } else {
      items.push({ kind: "text", key: `text:${item.id}`, card: item });
    }
  }
  return items;
}

/** True when the clips come from more than one game, so each row names its game. */
export function isMultiGame(items: WatchItem[]): boolean {
  const games = new Set<string>();
  for (const item of items) if (item.kind === "clip") games.add(item.matchId);
  return games.size > 1;
}

/**
 * Where Resume starts: the first uploaded clip not yet watched, or null when
 * every one has been (or there are none).
 */
export function firstUnwatchedKey(playlist: Playlist, watched: Set<string>): string | null {
  const clip = playableClips(playlist).find((c) => !watched.has(clipViewKey(playlist.id, c.matchId, c.eventId)));
  return clip ? clipKey(clip.matchId, clip.eventId) : null;
}

/** Watched and total over the uploaded clips, so 100% is always reachable. */
export function watchProgress(playlist: Playlist, watched: Set<string>): { watched: number; total: number } {
  const clips = playableClips(playlist);
  return {
    watched: clips.filter((c) => watched.has(clipViewKey(playlist.id, c.matchId, c.eventId))).length,
    total: clips.length,
  };
}

/**
 * Claims `key` in `recorded`: true the first time, false ever after. A watch
 * is recorded (and reported) only when this says so, however often playback
 * passes the watched point.
 */
export function recordOnce(recorded: Set<string>, key: string): boolean {
  if (recorded.has(key)) return false;
  recorded.add(key);
  return true;
}
