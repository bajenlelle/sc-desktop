-- 1. Drop the duplicate team-playlist SELECT policy added in migration 010
--    (playlists_team_read in 004 is identical; PostgreSQL ORs all matching
--    policies, so the duplicate is evaluated redundantly on every SELECT)
DROP POLICY IF EXISTS playlists_select_team_member ON playlists;

-- 2. Update playlists_team_read to use the current_user_team_ids() helper
--    (same principle as the profiles/team_members recursion fixes in 008/011)
DROP POLICY IF EXISTS playlists_team_read ON playlists;
CREATE POLICY playlists_team_read ON playlists
  FOR SELECT USING (
    team_id IS NOT NULL
    AND team_id IN (SELECT current_user_team_ids())
  );

-- 3. Update playlist_clips_team_read to use the same helper
DROP POLICY IF EXISTS playlist_clips_team_read ON playlist_clips;
CREATE POLICY playlist_clips_team_read ON playlist_clips
  FOR SELECT USING (
    playlist_id IN (
      SELECT id FROM playlists
      WHERE team_id IS NOT NULL
        AND team_id IN (SELECT current_user_team_ids())
    )
  );
