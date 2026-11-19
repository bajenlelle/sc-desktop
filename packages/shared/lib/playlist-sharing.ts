/**
 * Who a playlist is shared with: teams (every member) and people (direct
 * shares). Recipients can only watch clips that are in the cloud, so the
 * desktop uploads a playlist's clips before it writes new recipients; the
 * database notifies them only once the playlist has an uploaded clip
 * (20260831100000_ship_before_notify).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { setPlaylistTeams, setPlaylistUsers } from "./playlists-db";
import { isClipItem, type PlaylistItem } from "../types/match";

type Recipients = { teamIds?: string[]; userIds?: string[] };

/** Shared playlists need every clip in the cloud: recipients can't see unshipped clips. */
export function playlistIsShared(pl: Recipients): boolean {
  return (pl.teamIds?.length ?? 0) > 0 || (pl.userIds?.length ?? 0) > 0;
}

/** A shared playlist and how many of its clips its players don't have yet (no file uploaded). */
export interface HeldPlaylist<P> {
  playlist: P;
  count: number;
}

/**
 * The shared playlists holding clips players can't watch yet: the target when
 * any of its clips (from any game) has no file, and any other shared playlist
 * holding one of this game's clips with no file. The target first, then the
 * most held; ties keep the input order.
 */
export function heldForPlayers<P extends { id: string; items: readonly PlaylistItem[]; teamIds?: string[]; userIds?: string[] }>(
  playlists: readonly P[],
  matchId: string,
  targetId: string | null,
): HeldPlaylist<P>[] {
  const held: HeldPlaylist<P>[] = [];
  for (const playlist of playlists) {
    if (!playlistIsShared(playlist)) continue;
    let count = 0;
    let fromThisGame = false;
    for (const item of playlist.items) {
      if (!isClipItem(item) || item.r2Url) continue;
      count++;
      if (item.matchId === matchId) fromThisGame = true;
    }
    if (playlist.id === targetId ? count > 0 : fromThisGame) held.push({ playlist, count });
  }
  return held.sort((a, b) => Number(b.playlist.id === targetId) - Number(a.playlist.id === targetId) || b.count - a.count);
}

/** The recipients in the new lists that the playlist did not have. */
export function newRecipients(prev: Recipients, teamIds: readonly string[], userIds: readonly string[]): { teams: string[]; users: string[] } {
  const prevTeams = prev.teamIds ?? [];
  const prevUsers = prev.userIds ?? [];
  return {
    teams: teamIds.filter((id) => !prevTeams.includes(id)),
    users: userIds.filter((id) => !prevUsers.includes(id)),
  };
}

/** Writes the share rows, teams and people, in one go. This is what notifies recipients. */
export async function setPlaylistRecipients(
  sb: SupabaseClient,
  playlistId: string,
  teamIds: readonly string[],
  userIds: readonly string[],
): Promise<void> {
  await Promise.all([setPlaylistTeams(sb, playlistId, [...teamIds]), setPlaylistUsers(sb, playlistId, [...userIds])]);
}
