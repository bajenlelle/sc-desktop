import { createClient } from "@/lib/supabase/client";

/**
 * Nudge a recipient who hasn't finished a playlist. Server enforces
 * ownership, recipient reachability, and a 24h per-recipient cooldown.
 */
export async function sendPlaylistReminder(playlistId: string, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("send_playlist_reminder", {
    p_playlist_id: playlistId,
    p_user_id: userId,
  });
  if (error) {
    if (error.message.includes("too_soon"))
      throw new Error("Already reminded in the last 24 hours.");
    if (error.message.includes("not_owner"))
      throw new Error("Only the playlist owner can send reminders.");
    if (error.message.includes("not_recipient"))
      throw new Error("That member no longer receives this playlist.");
    throw new Error(`Failed to send reminder: ${error.message}`);
  }
}
