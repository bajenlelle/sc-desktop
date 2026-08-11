/**
 * Web wrapper — binds the browser Supabase client to the shared clip-views lib.
 * All logic lives in @scoutable/shared/lib/clip-views-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/clip-views-db";

const c = () => createClient();

export const listMyClipViews = () => db.listMyClipViews(c());
export const markClipWatched = (playlistId: string, matchId: string, eventId: number) =>
  db.markClipWatched(c(), playlistId, matchId, eventId);

export { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
export type { ClipView } from "@scoutable/shared/lib/clip-views-db";
