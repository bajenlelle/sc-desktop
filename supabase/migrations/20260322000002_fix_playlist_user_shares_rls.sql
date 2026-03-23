-- Fix infinite recursion in playlist_user_shares RLS.
--
-- The original playlist_user_shares_owner policy referenced the playlists
-- table. Combined with playlists_user_share_read (which references
-- playlist_user_shares), this created a circular dependency that caused
-- "infinite recursion detected in policy" errors.
--
-- Fix: use shared_by = auth.uid() instead of joining back to playlists.

DROP POLICY IF EXISTS playlist_user_shares_owner ON playlist_user_shares;

CREATE POLICY playlist_user_shares_owner ON playlist_user_shares FOR ALL
  USING (shared_by = auth.uid());
