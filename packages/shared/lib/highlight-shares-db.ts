/**
 * Highlight shares — rendered highlight MP4s hosted behind an unguessable
 * share id for the "send to phone" flow. Isomorphic: callers pass their
 * platform Supabase client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface HighlightShare {
  id: string;
  title: string;
  r2Url: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Insert a share row. The caller supplies the id so the R2 key
 * (highlights/{userId}/{id}.mp4) and the row can agree before upload.
 */
export async function createHighlightShare(
  supabase: SupabaseClient,
  share: {
    id: string;
    playlistId?: string;
    title: string;
    r2Url: string;
    r2Key: string;
    clipCount: number;
  }
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("highlight_shares").insert({
    id: share.id,
    user_id: user.id,
    playlist_id: share.playlistId ?? null,
    title: share.title,
    r2_url: share.r2Url,
    r2_key: share.r2Key,
    clip_count: share.clipCount,
  });
  if (error) throw new Error(`Failed to create highlight share: ${error.message}`);
}

/**
 * Newest non-expired share the caller created for a playlist — lets the
 * send-to-phone dialog reuse the existing link instead of re-rendering.
 */
export async function getMyShareForPlaylist(
  supabase: SupabaseClient,
  playlistId: string
): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await supabase
    .from("highlight_shares")
    .select("id, created_at")
    .eq("playlist_id", playlistId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, createdAt: data.created_at as string };
}

/** Anonymous-safe lookup used by the public /h/{id} page. */
export async function getHighlightShare(
  supabase: SupabaseClient,
  id: string
): Promise<
  | { valid: true; title: string; url: string; createdAt: string }
  | { valid: false; reason: "not_found" | "expired" }
> {
  const { data, error } = await supabase.rpc("get_highlight_share", { p_id: id });
  if (error) throw new Error(`Failed to load highlight: ${error.message}`);
  const r = data as { valid: boolean; reason?: string; title?: string; url?: string; created_at?: string };
  if (!r.valid) return { valid: false, reason: (r.reason as "not_found" | "expired") ?? "not_found" };
  return { valid: true, title: r.title!, url: r.url!, createdAt: r.created_at! };
}
