/**
 * Per-clip watch history for shared playlists.
 *
 * Rows are written by the player as they watch and read back to show what's
 * new, how far through a playlist they are, and where to resume. The playlist
 * owner can also read them (RLS), which is what the coach-facing view will
 * use.
 *
 * Each function accepts a SupabaseClient so this module is isomorphic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClipView {
  playlistId: string;
  matchId: string;
  eventId: number;
  watchedAt: string;
}

interface ClipViewRow {
  playlist_id: string;
  match_id: string;
  event_id: number;
  watched_at: string;
}

/** Stable key for a watched clip within a playlist. */
export function clipViewKey(playlistId: string, matchId: string, eventId: number): string {
  return `${playlistId}:${matchId}:${eventId}`;
}

/**
 * Every clip the current user has watched, across all playlists.
 *
 * The explicit user filter matters: RLS also grants playlist OWNERS read on
 * recipients' rows, so an unfiltered select would silently mix other
 * people's views into a coach's own progress.
 */
export async function listMyClipViews(supabase: SupabaseClient): Promise<ClipView[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("clip_views")
    .select("playlist_id, match_id, event_id, watched_at")
    .eq("user_id", user.id);
  if (error) { console.error("listMyClipViews:", error.message); return []; }
  return ((data ?? []) as ClipViewRow[]).map((r) => ({
    playlistId: r.playlist_id,
    matchId: r.match_id,
    eventId: r.event_id,
    watchedAt: r.watched_at,
  }));
}

export interface PlaylistClipView extends ClipView {
  userId: string;
}

/**
 * All recipients' views for the given playlists — the coach dashboard's
 * source. RLS (clip_views_owner_read) restricts this to playlists the
 * caller OWNS; for anything else it simply returns their own rows.
 */
export async function listPlaylistClipViews(
  supabase: SupabaseClient,
  playlistIds: string[],
): Promise<PlaylistClipView[]> {
  if (playlistIds.length === 0) return [];
  const { data, error } = await supabase
    .from("clip_views")
    .select("user_id, playlist_id, match_id, event_id, watched_at")
    .in("playlist_id", playlistIds);
  if (error) { console.error("listPlaylistClipViews:", error.message); return []; }
  return ((data ?? []) as (ClipViewRow & { user_id: string })[]).map((r) => ({
    userId: r.user_id,
    playlistId: r.playlist_id,
    matchId: r.match_id,
    eventId: r.event_id,
    watchedAt: r.watched_at,
  }));
}

/**
 * Record that the current user watched a clip.
 *
 * Idempotent: re-watching updates nothing, so callers can fire this without
 * tracking whether they've already sent it. Errors are swallowed — a missed
 * view row must never interrupt playback.
 */
export async function markClipWatched(
  supabase: SupabaseClient,
  playlistId: string,
  matchId: string,
  eventId: number,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("clip_views")
    .upsert(
      {
        user_id: user.id,
        playlist_id: playlistId,
        match_id: matchId,
        event_id: eventId,
      },
      { onConflict: "user_id,playlist_id,match_id,event_id", ignoreDuplicates: true },
    );
  if (error) console.error("markClipWatched:", error.message);
}
