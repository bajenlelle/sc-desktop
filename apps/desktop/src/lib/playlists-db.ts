/**
 * Desktop wrapper — binds the platform Supabase client to the shared DB lib.
 * All logic lives in @scoutable/shared/lib/playlists-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/playlists-db";
import type { PlaylistClipItem, PlaylistItem } from "@/types/match";

const c = () => createClient();

export const getMyTeamPlaylists = (teamIds?: string[]) => db.getMyTeamPlaylists(c(), teamIds);
export const listPlaylists = (orgId?: string, opts?: db.OrgScopeOpts) => db.listPlaylists(c(), orgId, opts);
export const createPlaylist = (name: string, folderId?: string, orgId?: string) => db.createPlaylist(c(), name, folderId, orgId);
export const updatePlaylist = (id: string, patch: { name?: string; folderId?: string | null }) => db.updatePlaylist(c(), id, patch);
export const deletePlaylist = (id: string) => db.deletePlaylist(c(), id);
export const addClips = (playlistId: string, clips: PlaylistClipItem[], startPosition: number) => db.addClips(c(), playlistId, clips, startPosition);
export const insertTextCard = (playlistId: string, itemId: string, text: string, durationSeconds: number, position: number) => db.insertTextCard(c(), playlistId, itemId, text, durationSeconds, position);
export const updateTextCard = (playlistId: string, itemId: string, patch: { text?: string; durationSeconds?: number }) => db.updateTextCard(c(), playlistId, itemId, patch);
export const removeClips = (playlistId: string, clipKeys: Array<{ matchId: string; eventId: number }>, textCardIds?: string[]) => db.removeClips(c(), playlistId, clipKeys, textCardIds);
export const reorderItems = (playlistId: string, items: PlaylistItem[]) => db.reorderItems(c(), playlistId, items);
export const updateClip = (playlistId: string, matchId: string, eventId: number, patch: { preRollOffset?: number; postRollOffset?: number; note?: string | null }) => db.updateClip(c(), playlistId, matchId, eventId, patch);
export const updateClipR2Url = (playlistId: string, matchId: string, eventId: number, r2Url: string) => db.updateClipR2Url(c(), playlistId, matchId, eventId, r2Url);
export const assignPlaylistToTeam = (playlistId: string, teamId: string | null) => db.assignPlaylistToTeam(c(), playlistId, teamId);
export const setPlaylistTeams = (playlistId: string, teamIds: string[]) => db.setPlaylistTeams(c(), playlistId, teamIds);
export const setPlaylistUsers = (playlistId: string, userIds: string[]) => db.setPlaylistUsers(c(), playlistId, userIds);
export const getMyDirectPlaylists = (teamIds?: string[]) => db.getMyDirectPlaylists(c(), teamIds);
export const getMySharedOutPlaylists = (teamIds?: string[]) => db.getMySharedOutPlaylists(c(), teamIds);
export const getMySharedPlaylists = (orgId?: string, opts?: db.OrgScopeOpts) => db.getMySharedPlaylists(c(), orgId, opts);
export type { SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
export const notifyPendingPlaylistShares = (playlistId: string) => db.notifyPendingPlaylistShares(c(), playlistId);
