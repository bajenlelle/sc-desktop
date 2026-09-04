/**
 * Desktop wrapper — binds the platform Supabase client to the shared
 * highlight-shares lib.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/highlight-shares-db";

const c = () => createClient();

export const createHighlightShare = (share: Parameters<typeof db.createHighlightShare>[1]) =>
  db.createHighlightShare(c(), share);
export const getMyShareForPlaylist = (
  playlistId: string,
  aspect: db.HighlightAspect,
  contentKey: string,
) => db.getMyShareForPlaylist(c(), playlistId, aspect, contentKey);
