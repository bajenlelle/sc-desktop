/**
 * Desktop wrapper — binds the platform Supabase client to the shared DB lib.
 * All logic lives in @scoutable/shared/lib/playlists-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/playlists-db";
import * as write from "@scoutable/shared/lib/playlist-write";
import * as sharing from "@scoutable/shared/lib/playlist-sharing";
import type { PlaylistClipItem, PlaylistItem } from "@/types/match";
import type { StatsCardSpec } from "@scoutable/shared/lib/stats-card";

const c = () => createClient();

export const getMyTeamPlaylists = (teamIds?: string[]) => db.getMyTeamPlaylists(c(), teamIds);
export const listPlaylists = (orgId?: string, opts?: db.OrgScopeOpts) => db.listPlaylists(c(), orgId, opts);
export const listPlaylistNames = (orgId?: string, opts?: db.OrgScopeOpts) => db.listPlaylistNames(c(), orgId, opts);
export const createPlaylist = (name: string, folderId?: string, orgId?: string) => db.createPlaylist(c(), name, folderId, orgId);
export const updatePlaylist = (id: string, patch: { name?: string; folderId?: string | null }) => db.updatePlaylist(c(), id, patch);
export const deletePlaylist = (id: string) => db.deletePlaylist(c(), id);
export const addClips = (playlistId: string, clips: PlaylistClipItem[], startPosition: number, opts?: { restore?: boolean }) => db.addClips(c(), playlistId, clips, startPosition, opts);
export const insertTextCard = (playlistId: string, itemId: string, text: string, durationSeconds: number, position: number, card?: StatsCardSpec) => db.insertTextCard(c(), playlistId, itemId, text, durationSeconds, position, card);
export const updateTextCard = (playlistId: string, itemId: string, patch: { text?: string; durationSeconds?: number; card?: StatsCardSpec | null }) => db.updateTextCard(c(), playlistId, itemId, patch);
export const removeClips = (playlistId: string, clipKeys: Array<{ matchId: string; eventId: number }>, textCardIds?: string[]) => db.removeClips(c(), playlistId, clipKeys, textCardIds);
export const reorderItems = (playlistId: string, items: PlaylistItem[]) => db.reorderItems(c(), playlistId, items);
export const updateClip = (playlistId: string, matchId: string, eventId: number, patch: { preRollOffset?: number; postRollOffset?: number; note?: string | null; cropKeyframes?: import("@scoutable/shared/lib/crop-path").CropKeyframe[] | null; drawings?: import("@scoutable/shared/lib/clip-drawing").ClipDrawing[] | null; slowMotion?: import("@scoutable/shared/lib/clip-timeline").SlowSection[] | null }) => db.updateClip(c(), playlistId, matchId, eventId, patch);
export const updateClipR2Url = (playlistId: string, matchId: string, eventId: number, r2Url: string) => db.updateClipR2Url(c(), playlistId, matchId, eventId, r2Url);
export const replaceClipR2Url = (playlistId: string, matchId: string, eventId: number, r2Url: string, previousUrl: string) => db.replaceClipR2Url(c(), playlistId, matchId, eventId, r2Url, previousUrl);
export const clearShippedClip = (playlistId: string, matchId: string, eventId: number, onlyIfUrl?: string) => db.clearShippedClip(c(), playlistId, matchId, eventId, onlyIfUrl);
export const listOwnClipsForMatch = (matchId: string) => db.listOwnClipsForMatch(c(), matchId);
export const clearLegacyShippedClipsForMatch = (matchId: string) => db.clearLegacyShippedClipsForMatch(c(), matchId);
export const assignPlaylistToTeam = (playlistId: string, teamId: string | null) => db.assignPlaylistToTeam(c(), playlistId, teamId);
export const setPlaylistTeams = (playlistId: string, teamIds: string[]) => db.setPlaylistTeams(c(), playlistId, teamIds);
export const setPlaylistUsers = (playlistId: string, userIds: string[]) => db.setPlaylistUsers(c(), playlistId, userIds);
export const getMyDirectPlaylists = (scope?: db.DirectShareScope) => db.getMyDirectPlaylists(c(), scope);
export const getMySharedOutPlaylists = (teamIds?: string[]) => db.getMySharedOutPlaylists(c(), teamIds);
export const getMySharedPlaylists = (orgId?: string, opts?: db.OrgScopeOpts) => db.getMySharedPlaylists(c(), orgId, opts);
export const listOwnPlaylistsAndShared = (orgId?: string, opts?: db.OrgScopeOpts) => db.listOwnPlaylistsAndShared(c(), orgId, opts);
export const hasSharedAnyPlaylist = () => db.hasSharedAnyPlaylist(c());
export type { SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
export const notifyPendingPlaylistShares = (playlistId: string) => db.notifyPendingPlaylistShares(c(), playlistId);
// The editor's write path and clip appends (@scoutable/shared/lib/playlist-write).
export const writePlaylistItems = (playlistId: string, from: readonly PlaylistItem[], to: readonly PlaylistItem[]) => write.writePlaylistItems(c(), playlistId, from, to);
export const appendClips = (playlist: { id: string; items: readonly PlaylistItem[] }, clips: readonly PlaylistClipItem[]) => write.appendClips(c(), playlist, clips);
export const changeClipLength = (playlistId: string, clip: PlaylistClipItem, pre: number, post: number) => write.changeClipLength(c(), playlistId, clip, pre, post);
export type { ClipLengthResult } from "@scoutable/shared/lib/playlist-write";
export const setPlaylistRecipients = (playlistId: string, teamIds: readonly string[], userIds: readonly string[]) => sharing.setPlaylistRecipients(c(), playlistId, teamIds, userIds);
