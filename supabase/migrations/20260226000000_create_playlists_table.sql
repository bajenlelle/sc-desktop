-- =============================================================================
-- New top-level playlists table (decoupled from matches)
-- =============================================================================
CREATE TABLE playlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  folder_id   UUID REFERENCES playlist_folders(id) ON DELETE SET NULL,
  clips       JSONB NOT NULL DEFAULT '[]',   -- PlaylistClip[]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_playlists_user ON playlists (user_id, created_at DESC);
CREATE INDEX idx_playlists_folder ON playlists (folder_id);

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "playlists_owner"
  ON playlists FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TRIGGER playlists_updated_at
  BEFORE UPDATE ON playlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Migrate existing playlists from matches.playlists JSONB into the new table
-- =============================================================================
INSERT INTO playlists (id, user_id, name, folder_id, clips, created_at, updated_at)
SELECT
  (elem->>'id')::uuid,
  m.user_id,
  elem->>'name',
  CASE WHEN elem->>'folderId' IS NOT NULL THEN (elem->>'folderId')::uuid ELSE NULL END,
  COALESCE(elem->'clips', '[]'::jsonb),
  m.created_at,
  m.updated_at
FROM matches m,
     jsonb_array_elements(m.playlists) AS elem
WHERE jsonb_array_length(m.playlists) > 0
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Drop the old column
-- =============================================================================
ALTER TABLE matches DROP COLUMN IF EXISTS playlists;
