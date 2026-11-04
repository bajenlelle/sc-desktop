/**
 * Who a playlist is shared with: teams (every member) and people (direct
 * shares). Recipients can only watch clips that are in the cloud, so the
 * desktop uploads a playlist's clips before it writes new recipients; the
 * database notifies them only once the playlist has an uploaded clip
 * (20260831100000_ship_before_notify).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { setPlaylistTeams, setPlaylistUsers } from "./playlists-db";

type Recipients = { teamIds?: string[]; userIds?: string[] };

/** Shared playlists need every clip in the cloud: recipients can't see unshipped clips. */
export function playlistIsShared(pl: Recipients): boolean {
  return (pl.teamIds?.length ?? 0) > 0 || (pl.userIds?.length ?? 0) > 0;
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
