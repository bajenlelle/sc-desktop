-- =============================================================================
-- Shared playlists must not expose the whole game.
--
-- events_team_playlist_read granted SELECT on ALL play-by-play events of any
-- match referenced by a team-shared playlist — so teammates could browse
-- each other's entire imported games in the Library/Clip Browser. Narrow it
-- to exactly the shared clips' (match_id, event_id) pairs.
--
-- Both policies also gain a playlist_user_shares branch: direct-share
-- recipients were never covered at all and relied on the team overreach.
-- =============================================================================

DROP POLICY IF EXISTS events_team_playlist_read ON play_by_play_events;
CREATE POLICY events_team_playlist_read ON play_by_play_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM playlist_clips pc
      JOIN playlists p ON p.id = pc.playlist_id
      WHERE pc.match_id = play_by_play_events.match_id
        AND pc.event_id = play_by_play_events.event_id
        AND (
          (p.team_id IS NOT NULL AND p.team_id IN (SELECT current_user_team_ids()))
          OR p.id IN (
            SELECT ps.playlist_id FROM playlist_shares ps
            WHERE ps.team_id IN (SELECT current_user_team_ids())
          )
          OR p.id IN (
            SELECT pus.playlist_id FROM playlist_user_shares pus
            WHERE pus.user_id = (SELECT auth.uid())
          )
        )
    )
  );

-- Match-level read stays (titles/teams/dates are needed to render a shared
-- playlist) but now also covers direct shares.
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
          OR p.id IN (
            SELECT ps.playlist_id FROM playlist_shares ps
            WHERE ps.team_id IN (SELECT current_user_team_ids())
          )
          OR p.id IN (
            SELECT pus.playlist_id FROM playlist_user_shares pus
            WHERE pus.user_id = (SELECT auth.uid())
          )
        )
    )
  );

-- The narrowed events policy point-looks-up playlist_clips by
-- (match_id, event_id) for every event row — make that cheap.
CREATE INDEX IF NOT EXISTS idx_playlist_clips_match_event
  ON playlist_clips (match_id, event_id);
