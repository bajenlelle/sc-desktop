-- Team members can read matches referenced in playlists assigned to their team.
-- game-videos storage is already public, so videoUrl will stream fine once the row is readable.
CREATE POLICY matches_team_playlist_read ON matches
  FOR SELECT USING (
    id IN (
      SELECT DISTINCT pc.match_id
      FROM playlist_clips pc
      JOIN playlists p ON p.id = pc.playlist_id
      WHERE p.team_id IS NOT NULL
        AND p.team_id IN (SELECT current_user_team_ids())
        AND pc.match_id IS NOT NULL
    )
  );

-- Team members can read events whose parent match is in a team playlist.
CREATE POLICY events_team_playlist_read ON play_by_play_events
  FOR SELECT USING (
    match_id IN (
      SELECT DISTINCT pc.match_id
      FROM playlist_clips pc
      JOIN playlists p ON p.id = pc.playlist_id
      WHERE p.team_id IS NOT NULL
        AND p.team_id IN (SELECT current_user_team_ids())
        AND pc.match_id IS NOT NULL
    )
  );
