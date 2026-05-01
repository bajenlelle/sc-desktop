-- Fix: playlists_team_share_read causes infinite recursion.
--
-- playlists_team_share_read queries playlist_shares, which has a playlist_shares_owner
-- policy that queries back into playlists — creating a cycle.
--
-- Solution: same pattern as current_user_team_ids() — a SECURITY DEFINER helper
-- that reads playlist_shares bypassing RLS, so the playlists policy can safely
-- call it without triggering playlist_shares policies.

CREATE OR REPLACE FUNCTION current_user_team_playlist_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT playlist_id
  FROM playlist_shares
  WHERE team_id IN (SELECT current_user_team_ids());
$$;

-- Recreate the policy using the SECURITY DEFINER helper
DROP POLICY IF EXISTS playlists_team_share_read ON playlists;
CREATE POLICY playlists_team_share_read ON playlists
  FOR SELECT USING (
    id IN (SELECT current_user_team_playlist_ids())
  );
