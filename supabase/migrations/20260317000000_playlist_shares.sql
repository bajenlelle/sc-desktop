-- Many-to-many join table for playlist → team sharing.
-- Replaces the single-team team_id column with a proper join table.
CREATE TABLE playlist_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE NOT NULL,
  team_id     uuid REFERENCES teams(id)    ON DELETE CASCADE NOT NULL,
  shared_at   timestamptz DEFAULT now() NOT NULL,
  UNIQUE(playlist_id, team_id)
);

CREATE INDEX idx_playlist_shares_playlist ON playlist_shares(playlist_id);
CREATE INDEX idx_playlist_shares_team     ON playlist_shares(team_id);

-- RLS: owner can fully manage their playlist's shares
ALTER TABLE playlist_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY playlist_shares_owner ON playlist_shares
  USING (
    playlist_id IN (SELECT id FROM playlists WHERE user_id = auth.uid())
  );

-- Team members can read shares for their teams (so players can discover assigned playlists)
CREATE POLICY playlist_shares_team_read ON playlist_shares
  FOR SELECT USING (
    team_id IN (SELECT current_user_team_ids())
  );

-- Backfill: migrate existing single team_id values into the new join table
INSERT INTO playlist_shares (playlist_id, team_id)
SELECT id, team_id FROM playlists WHERE team_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Also allow team members to SELECT playlist_clips for playlists shared via playlist_shares
CREATE POLICY playlist_clips_shared_team_read ON playlist_clips
  FOR SELECT USING (
    playlist_id IN (
      SELECT ps.playlist_id
      FROM playlist_shares ps
      WHERE ps.team_id IN (SELECT current_user_team_ids())
    )
  );
