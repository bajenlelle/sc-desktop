/**
 * Playlist watch reminders — "Remind" on the coach dashboard.
 *
 * Throws user-facing messages (unlike the query helpers that degrade via
 * reportDbError) because every call site puts the text straight into a
 * toast/alert. NOTE: bulk-remind flows detect the cooldown case by matching
 * the literal "24 hours" in the message — keep the copy and that check in
 * sync.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nudge a recipient who hasn't finished a playlist. Server enforces
 * ownership, recipient reachability, and a 24h per-recipient cooldown.
 */
export async function sendPlaylistReminder(
  supabase: SupabaseClient,
  playlistId: string,
  userId: string,
): Promise<void> {
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
