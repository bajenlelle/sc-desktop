-- Extend playlists with team ownership + author tracking.
-- All columns nullable so existing personal playlists are unaffected.
ALTER TABLE playlists
  ADD COLUMN team_id    uuid REFERENCES teams(id)    ON DELETE SET NULL,
  ADD COLUMN created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Partial indexes: skip NULL rows to avoid bloat during early rollout
CREATE INDEX idx_playlists_team    ON playlists (team_id)    WHERE team_id IS NOT NULL;
CREATE INDEX idx_playlists_creator ON playlists (created_by) WHERE created_by IS NOT NULL;

-- Add r2_url to playlist_clips for Clip & Ship upload links
ALTER TABLE playlist_clips ADD COLUMN r2_url text;
