-- Individual user playlist sharing
-- Allows coaches to share playlists with specific users (not just teams)

CREATE TABLE playlist_user_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(playlist_id, user_id)
);

CREATE INDEX ON playlist_user_shares(playlist_id);
CREATE INDEX ON playlist_user_shares(user_id);

ALTER TABLE playlist_user_shares ENABLE ROW LEVEL SECURITY;

-- Playlist owner manages their shares
CREATE POLICY playlist_user_shares_owner ON playlist_user_shares FOR ALL
  USING (playlist_id IN (SELECT id FROM playlists WHERE user_id = auth.uid()));

-- Recipient can read their own share records
CREATE POLICY playlist_user_shares_recipient ON playlist_user_shares FOR SELECT
  USING (user_id = auth.uid());

-- Allow recipients to read playlists shared directly with them
CREATE POLICY playlists_user_share_read ON playlists FOR SELECT
  USING (id IN (SELECT playlist_id FROM playlist_user_shares WHERE user_id = auth.uid()));

-- Allow recipients to read clips in playlists shared directly with them
CREATE POLICY playlist_clips_user_share_read ON playlist_clips FOR SELECT
  USING (playlist_id IN (SELECT playlist_id FROM playlist_user_shares WHERE user_id = auth.uid()));
