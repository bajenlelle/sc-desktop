-- Extend match/event RLS to cover playlists shared via playlist_shares (multi-team),
-- not just playlists with the legacy playlists.team_id column set.

DROP POLICY IF EXISTS matches_team_playlist_read ON matches;
CREATE POLICY matches_team_playlist_read ON matches
  FOR SELECT USING (
    id IN (
      SELECT DISTINCT pc.match_id
      FROM playlist_clips pc
      JOIN playlists p ON p.id = pc.playlist_id
      WHERE pc.match_id IS NOT NULL
        AND (
          (p.team_id IS NOT NULL AND p.team_id IN (SELECT current_user_team_ids()))
          OR
          p.id IN (
            SELECT ps.playlist_id FROM playlist_shares ps
            WHERE ps.team_id IN (SELECT current_user_team_ids())
          )
        )
    )
  );

DROP POLICY IF EXISTS events_team_playlist_read ON play_by_play_events;
CREATE POLICY events_team_playlist_read ON play_by_play_events
  FOR SELECT USING (
    match_id IN (
      SELECT DISTINCT pc.match_id
      FROM playlist_clips pc
      JOIN playlists p ON p.id = pc.playlist_id
      WHERE pc.match_id IS NOT NULL
        AND (
          (p.team_id IS NOT NULL AND p.team_id IN (SELECT current_user_team_ids()))
          OR
          p.id IN (
            SELECT ps.playlist_id FROM playlist_shares ps
            WHERE ps.team_id IN (SELECT current_user_team_ids())
          )
        )
    )
  );
