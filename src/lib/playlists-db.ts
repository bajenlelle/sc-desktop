/**
 * Database operations for the playlists and playlist_clips tables.
 * Clips and text cards are stored in the playlist_clips relational table.
 * All queries run through the browser Supabase client — RLS enforces ownership.
 */

import { createClient } from "@/lib/supabase/client";
import type { Playlist, PlaylistItem, PlaylistClipItem, PlaylistTextCard } from "@/types/match";

// ---------------------------------------------------------------------------
// DB row types (snake_case columns from Postgres)
// ---------------------------------------------------------------------------

interface PlaylistClipRow {
  item_type: string;
  item_id: string | null;
  match_id: string | null;
  event_id: number | null;
  position: number;
  pre_roll_offset: number;
  post_roll_offset: number;
  note: string | null;
  text_content: string | null;
  duration_seconds: number | null;
  r2_url: string | null;
}

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  folder_id: string | null;
  team_id: string | null;
  created_at: string;
  updated_at: string;
  playlist_clips: PlaylistClipRow[];
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  const items = [...(row.playlist_clips ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((c): PlaylistItem | null => {
      if (c.item_type === 'text') {
        if (!c.item_id) return null;
        return {
          type: 'text',
          id: c.item_id,
          text: c.text_content ?? '',
          durationSeconds: c.duration_seconds ?? 5,
        } satisfies PlaylistTextCard;
      }
      // Default: clip
      if (!c.match_id || c.event_id === null) return null;
      return {
        type: 'clip',
        matchId: c.match_id,
        eventId: c.event_id,
        ...(c.pre_roll_offset !== 0 ? { preRollOffset: c.pre_roll_offset } : {}),
        ...(c.post_roll_offset !== 0 ? { postRollOffset: c.post_roll_offset } : {}),
        ...(c.note ? { note: c.note } : {}),
        ...(c.r2_url ? { r2Url: c.r2_url } : {}),
      } satisfies PlaylistClipItem;
    })
    .filter((x): x is PlaylistItem => x !== null);
  return {
    id: row.id,
    name: row.name,
    items,
    folderId: row.folder_id ?? undefined,
    teamId: row.team_id ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// List playlists assigned to the current user's teams (player view)
// ---------------------------------------------------------------------------

export async function getMyTeamPlaylists(): Promise<Playlist[]> {
  const supabase = createClient();
  // RLS already filters to playlists for teams the caller belongs to
  // (via current_user_team_ids() in the playlists_team_read policy)
  const { data, error } = await supabase
    .from("playlists")
    .select(`
      id,
      user_id,
      name,
      folder_id,
      team_id,
      created_at,
      updated_at,
      playlist_clips (
        item_type,
        item_id,
        match_id,
        event_id,
        position,
        pre_roll_offset,
        post_roll_offset,
        note,
        text_content,
        duration_seconds,
        r2_url
      )
    `)
    .not("team_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) { console.error("getMyTeamPlaylists:", error.message); return []; }
  if (!data) return [];
  return (data as PlaylistRow[]).map(rowToPlaylist);
}

// ---------------------------------------------------------------------------
// List all playlists for the current user (with items via join)
// ---------------------------------------------------------------------------

export async function listPlaylists(): Promise<Playlist[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("playlists")
    .select(`
      id,
      user_id,
      name,
      folder_id,
      team_id,
      created_at,
      updated_at,
      playlist_clips (
        item_type,
        item_id,
        match_id,
        event_id,
        position,
        pre_roll_offset,
        post_roll_offset,
        note,
        text_content,
        duration_seconds,
        r2_url
      )
    `)
    .order("created_at", { ascending: false });
  if (error) { console.error("listPlaylists:", error.message); return []; }
  if (!data) return [];
  return (data as PlaylistRow[]).map(rowToPlaylist);
}

// ---------------------------------------------------------------------------
// Create a new playlist (empty — items are added separately)
// ---------------------------------------------------------------------------

export async function createPlaylist(
  name: string,
  folderId?: string
): Promise<Playlist> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("playlists")
    .insert({
      user_id: user.id,
      name,
      folder_id: folderId ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create playlist: ${error?.message}`);
  return { id: data.id, name: data.name, items: [], folderId: data.folder_id ?? undefined };
}

// ---------------------------------------------------------------------------
// Update playlist metadata (name and/or folder assignment)
// ---------------------------------------------------------------------------

export async function updatePlaylist(
  id: string,
  patch: { name?: string; folderId?: string | null }
): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if ("folderId" in patch) row.folder_id = patch.folderId ?? null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("playlists").update(row).eq("id", id);
  if (error) throw new Error(`Failed to update playlist: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Delete a playlist (CASCADE removes its items automatically)
// ---------------------------------------------------------------------------

export async function deletePlaylist(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete playlist: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Add clips to a playlist
// startPosition is the position index for the first new clip (typically
// the current item count so new clips are appended at the end).
// ---------------------------------------------------------------------------

export async function addClips(
  playlistId: string,
  clips: PlaylistClipItem[],
  startPosition: number
): Promise<void> {
  if (clips.length === 0) return;
  const supabase = createClient();
  const rows = clips.map((clip, i) => ({
    playlist_id: playlistId,
    item_type: 'clip',
    match_id: clip.matchId,
    event_id: clip.eventId,
    position: startPosition + i,
    pre_roll_offset: clip.preRollOffset ?? 0,
    post_roll_offset: clip.postRollOffset ?? 0,
    note: clip.note ?? null,
  }));
  const { error } = await supabase.from("playlist_clips").insert(rows);
  if (error) throw new Error(`Failed to add clips: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Insert a text card into a playlist at a given position
// ---------------------------------------------------------------------------

export async function insertTextCard(
  playlistId: string,
  itemId: string,
  text: string,
  durationSeconds: number,
  position: number
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("playlist_clips").insert({
    playlist_id: playlistId,
    item_type: 'text',
    item_id: itemId,
    text_content: text,
    duration_seconds: durationSeconds,
    position,
    match_id: null,
    event_id: null,
    pre_roll_offset: 0,
    post_roll_offset: 0,
  });
  if (error) throw new Error(`Failed to insert text card: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Update a text card's content or duration
// ---------------------------------------------------------------------------

export async function updateTextCard(
  playlistId: string,
  itemId: string,
  patch: { text?: string; durationSeconds?: number }
): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.text !== undefined) row.text_content = patch.text;
  if (patch.durationSeconds !== undefined) row.duration_seconds = patch.durationSeconds;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from("playlist_clips")
    .update(row)
    .eq("playlist_id", playlistId)
    .eq("item_id", itemId);
  if (error) throw new Error(`Failed to update text card: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Remove specific items from a playlist
// Accepts clip keys (matchId + eventId) and text card ids (item_id).
// ---------------------------------------------------------------------------

export async function removeClips(
  playlistId: string,
  clipKeys: Array<{ matchId: string; eventId: number }>,
  textCardIds: string[] = []
): Promise<void> {
  if (clipKeys.length === 0 && textCardIds.length === 0) return;
  const supabase = createClient();
  await Promise.all([
    ...clipKeys.map(({ matchId, eventId }) =>
      supabase
        .from("playlist_clips")
        .delete()
        .eq("playlist_id", playlistId)
        .eq("match_id", matchId)
        .eq("event_id", eventId)
    ),
    ...(textCardIds.length > 0
      ? [supabase
          .from("playlist_clips")
          .delete()
          .eq("playlist_id", playlistId)
          .in("item_id", textCardIds)]
      : []),
  ]);
}

// ---------------------------------------------------------------------------
// Update item positions after a reorder / insert operation
// Handles both clip items (keyed by match_id+event_id) and text cards (keyed by item_id).
// ---------------------------------------------------------------------------

export async function reorderItems(
  playlistId: string,
  items: PlaylistItem[]
): Promise<void> {
  if (items.length === 0) return;
  const supabase = createClient();
  const p_items = items.map((item, i) =>
    item.type === 'text'
      ? { item_type: 'text', item_id: item.id, position: i }
      : { item_type: 'clip', match_id: item.matchId, event_id: item.eventId, position: i }
  );
  const { error } = await supabase.rpc('reorder_playlist_items', {
    p_playlist_id: playlistId,
    p_items,
  });
  if (error) throw new Error(`Failed to reorder items: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Update a single clip's pre/post-roll offsets or note
// ---------------------------------------------------------------------------

export async function updateClip(
  playlistId: string,
  matchId: string,
  eventId: number,
  patch: { preRollOffset?: number; postRollOffset?: number; note?: string | null }
): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.preRollOffset !== undefined) row.pre_roll_offset = patch.preRollOffset;
  if (patch.postRollOffset !== undefined) row.post_roll_offset = patch.postRollOffset;
  if ("note" in patch) row.note = patch.note ?? null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from("playlist_clips")
    .update(row)
    .eq("playlist_id", playlistId)
    .eq("match_id", matchId)
    .eq("event_id", eventId);
  if (error) throw new Error(`Failed to update clip: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Save the Cloudflare R2 URL for a clip after a Clip & Ship export
// ---------------------------------------------------------------------------

export async function updateClipR2Url(
  playlistId: string,
  matchId: string,
  eventId: number,
  r2Url: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("playlist_clips")
    .update({ r2_url: r2Url })
    .eq("playlist_id", playlistId)
    .eq("match_id", matchId)
    .eq("event_id", eventId);
  if (error) throw new Error(`Failed to save R2 URL: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Assign (or unassign) a playlist to a team
// ---------------------------------------------------------------------------

export async function assignPlaylistToTeam(
  playlistId: string,
  teamId: string | null
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("playlists")
    .update({ team_id: teamId })
    .eq("id", playlistId);
  if (error) throw new Error(`Failed to assign playlist to team: ${error.message}`);
}
