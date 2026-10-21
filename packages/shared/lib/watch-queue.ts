/**
 * What a recipient watches when they open a shared playlist, and how their
 * progress through it is counted. Pure, so the web watch view's rules are
 * tested here: which items make the list, where Resume starts, what counts
 * as watched, and that a clip is recorded as watched once.
 *
 * Clips are identified by game and event together: event ids number the
 * plays within one game, so two games in one playlist can share them.
 *
 * A clip normally plays from its own uploaded file. When the viewer has the
 * game's cloud copy (they uploaded it), a clip without a file plays as a
 * window of that copy instead: the same seconds the desktop would cut.
 */
import type { Playlist, PlayByPlayEvent, PlaylistTextCard, SyncPoint } from "../types/match";
import { isClipItem } from "../types/match";
import type { OrgMembership } from "../types/org";
import { clipBounds, computeVideoTime, playlistRolls } from "./clip-timing";
import { clipViewKey } from "./clip-views-db";
import { isStaffRole } from "./orgs";
import { isPlayerCard } from "./player-card";
import { playableClips } from "./playlist-feed";

/** One item a recipient can watch: a clip's own uploaded file, a window of the game's cloud copy, or a timed text card. */
export type WatchItem =
  | { kind: "clip"; key: string; event: PlayByPlayEvent; matchId: string; r2Url: string; note?: string }
  | { kind: "window"; key: string; event: PlayByPlayEvent; matchId: string; start: number; end: number; note?: string }
  | { kind: "text"; key: string; card: PlaylistTextCard };

/** The games whose cloud copy the viewer may watch, with the sync that places their plays. */
export interface CloudGames {
  syncByMatch: ReadonlyMap<string, SyncPoint>;
  /**
   * Play every clip of a game the viewer has the copy of as a window, even
   * one with an uploaded file: the editor's owner sees a trim the moment it
   * is made, not when the file is cut again.
   */
  preferWindows?: boolean;
}

/** The key a clip goes by in the watch list. */
export function clipKey(matchId: string, eventId: number): string {
  return `${matchId}:${eventId}`;
}

/**
 * The playlist's items in order, as the recipient sees them. Clips that are
 * not uploaded yet are left out (a row they can never play only reads as
 * broken), unless the viewer has the game's cloud copy, which plays them as
 * windows; and so are clips whose play the game data no longer has.
 */
export function buildWatchItems(
  playlist: Playlist,
  eventByKey: Map<string, PlayByPlayEvent>,
  cloud?: CloudGames,
): WatchItem[] {
  const items: WatchItem[] = [];
  const rolls = playlistRolls(playlist);
  for (const item of playlist.items) {
    // A scouting-report entry, not footage: the owner's own playlist can carry one.
    if (isPlayerCard(item)) continue;
    if (isClipItem(item)) {
      const key = clipKey(item.matchId, item.eventId);
      const event = eventByKey.get(key);
      if (!event) continue;
      const sync = cloud?.syncByMatch.get(item.matchId);
      const asWindow = sync && (!item.r2Url || cloud?.preferWindows);
      if (!asWindow) {
        if (item.r2Url) items.push({ kind: "clip", key, event, matchId: item.matchId, r2Url: item.r2Url, note: item.note });
        continue;
      }
      const time = computeVideoTime(event, sync);
      if (time === null) {
        // The copy can't place the play; its own file, when it has one, still can.
        if (item.r2Url) items.push({ kind: "clip", key, event, matchId: item.matchId, r2Url: item.r2Url, note: item.note });
        continue;
      }
      const { start, end } = clipBounds(time, rolls.pre, rolls.post, item.preRollOffset, item.postRollOffset);
      items.push({ kind: "window", key, event, matchId: item.matchId, start, end, note: item.note });
    } else {
      items.push({ kind: "text", key: `text:${item.id}`, card: item });
    }
  }
  return items;
}

/** True when the clips come from more than one game, so each row names its game. */
export function isMultiGame(items: WatchItem[]): boolean {
  const games = new Set<string>();
  for (const item of items) if (item.kind !== "text") games.add(item.matchId);
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
 * Whether the viewer gets a timeline they can drag. A clip counts as watched
 * once playback nears its end, so a player who could drag to the end would
 * mark it watched without watching it: players get a read-only progress
 * line. The playlist's owner and the coaches and admins of its club keep the
 * timeline, wherever they open it. Someone outside the club (an ex-member, a
 * playlist from another club) is a viewer like any player.
 */
export function canScrubPlaylist(
  viewer: { userId: string | null | undefined; myOrgs: OrgMembership[] },
  playlist: Pick<Playlist, "orgId" | "createdBy">,
): boolean {
  if (viewer.userId && playlist.createdBy === viewer.userId) return true;
  if (!playlist.orgId) return false;
  return isStaffRole(viewer.myOrgs.find((o) => o.orgId === playlist.orgId)?.role);
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
