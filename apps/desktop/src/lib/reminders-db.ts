/**
 * Desktop wrapper — binds the platform Supabase client to the shared
 * reminders lib.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/reminders-db";

export const sendPlaylistReminder = (playlistId: string, userId: string) =>
  db.sendPlaylistReminder(createClient(), playlistId, userId);
