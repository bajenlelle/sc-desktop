/**
 * Database operations for the top-level playlists table.
 * All queries run through the browser Supabase client — RLS enforces ownership.
 */

import { createClient } from "@/lib/supabase/client";
import type { Playlist, PlaylistClip } from "@/types/match";

// ---------------------------------------------------------------------------
// DB row type (snake_case columns from Postgres)
// ---------------------------------------------------------------------------

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  folder_id: string | null;
  clips: PlaylistClip[];
  created_at: string;
  updated_at: string;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    clips: row.clips ?? [],
    folderId: row.folder_id ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// List all playlists for the current user
// ---------------------------------------------------------------------------

export async function listPlaylists(): Promise<Playlist[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("playlists")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as PlaylistRow[]).map(rowToPlaylist);
}

// ---------------------------------------------------------------------------
// Create a new playlist
// ---------------------------------------------------------------------------

export async function createPlaylist(
  name: string,
  clips: PlaylistClip[],
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
      clips,
      folder_id: folderId ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create playlist: ${error?.message}`);
  return rowToPlaylist(data as PlaylistRow);
}

// ---------------------------------------------------------------------------
// Update a playlist (partial patch)
// ---------------------------------------------------------------------------

export async function updatePlaylist(
  id: string,
  patch: { name?: string; folderId?: string | null; clips?: PlaylistClip[] }
): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if ("folderId" in patch) row.folder_id = patch.folderId ?? null;
  if (patch.clips !== undefined) row.clips = patch.clips;
  const { error } = await supabase.from("playlists").update(row).eq("id", id);
  if (error) throw new Error(`Failed to update playlist: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Delete a playlist
// ---------------------------------------------------------------------------

export async function deletePlaylist(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete playlist: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Remove all clips referencing a given match from every playlist
// ---------------------------------------------------------------------------

export async function removeClipsByMatchId(matchId: string): Promise<void> {
  const playlists = await listPlaylists();
  const affected = playlists.filter((p) =>
    p.clips.some((c) => c.matchId === matchId)
  );
  await Promise.all(
    affected.map((p) =>
      updatePlaylist(p.id, {
        clips: p.clips.filter((c) => c.matchId !== matchId),
      })
    )
  );
}
