/**
 * Database operations for the playlists and playlist_clips tables.
 * Clips are stored in the playlist_clips relational table (not JSONB).
 * All queries run through the browser Supabase client — RLS enforces ownership.
 */

import { createClient } from "@/lib/supabase/client";
import type { Playlist, PlaylistClip } from "@/types/match";

// ---------------------------------------------------------------------------
// DB row types (snake_case columns from Postgres)
// ---------------------------------------------------------------------------

interface PlaylistClipRow {
  match_id: string;
  event_id: number;
  position: number;
  pre_roll_offset: number;
  post_roll_offset: number;
  note: string | null;
}

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  playlist_clips: PlaylistClipRow[];
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  const clips = [...(row.playlist_clips ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((c): PlaylistClip => ({
      matchId: c.match_id,
      eventId: c.event_id,
      ...(c.pre_roll_offset !== 0 ? { preRollOffset: c.pre_roll_offset } : {}),
      ...(c.post_roll_offset !== 0 ? { postRollOffset: c.post_roll_offset } : {}),
      ...(c.note ? { note: c.note } : {}),
    }));
  return {
    id: row.id,
    name: row.name,
    clips,
    folderId: row.folder_id ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// List all playlists for the current user (with clips via join)
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
      created_at,
      updated_at,
      playlist_clips (
        match_id,
        event_id,
        position,
        pre_roll_offset,
        post_roll_offset,
        note
      )
    `)
    .order("created_at", { ascending: false });
  if (error) { console.error("listPlaylists:", error.message); return []; }
  if (!data) return [];
  return (data as PlaylistRow[]).map(rowToPlaylist);
}

// ---------------------------------------------------------------------------
// Create a new playlist (empty — clips are added separately)
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
  return { id: data.id, name: data.name, clips: [], folderId: data.folder_id ?? undefined };
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
// Delete a playlist (CASCADE removes its clips automatically)
// ---------------------------------------------------------------------------

export async function deletePlaylist(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete playlist: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Add clips to a playlist
// startPosition is the position index for the first new clip (typically
// the current clip count so new clips are appended at the end).
// ---------------------------------------------------------------------------

export async function addClips(
  playlistId: string,
  clips: PlaylistClip[],
  startPosition: number
): Promise<void> {
  if (clips.length === 0) return;
  const supabase = createClient();
  const rows = clips.map((clip, i) => ({
    playlist_id: playlistId,
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
// Remove specific clips from a playlist
// ---------------------------------------------------------------------------

export async function removeClips(
  playlistId: string,
  keys: Array<{ matchId: string; eventId: number }>
): Promise<void> {
  if (keys.length === 0) return;
  const supabase = createClient();
  await Promise.all(
    keys.map(({ matchId, eventId }) =>
      supabase
        .from("playlist_clips")
        .delete()
        .eq("playlist_id", playlistId)
        .eq("match_id", matchId)
        .eq("event_id", eventId)
    )
  );
}

// ---------------------------------------------------------------------------
// Update clip positions after a reorder operation
// ---------------------------------------------------------------------------

export async function reorderClips(
  playlistId: string,
  clips: PlaylistClip[]
): Promise<void> {
  if (clips.length === 0) return;
  const supabase = createClient();
  await Promise.all(
    clips.map((clip, i) =>
      supabase
        .from("playlist_clips")
        .update({ position: i })
        .eq("playlist_id", playlistId)
        .eq("match_id", clip.matchId)
        .eq("event_id", clip.eventId)
    )
  );
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
