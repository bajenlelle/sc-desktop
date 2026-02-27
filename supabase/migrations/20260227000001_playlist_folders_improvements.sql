-- =============================================================================
-- playlist_folders improvements
--   1. Replace per-row auth.uid() RLS with the subquery-evaluated form
--   2. Add composite index (user_id, sort_order) for listFolders() query
--   3. Add updated_at column + trigger for consistency with other tables
-- =============================================================================

-- 1. Fix RLS: drop the old policy and replace it with the optimised form
--    (SELECT auth.uid()) is evaluated once per statement, not once per row.
DROP POLICY IF EXISTS "Users manage own folders" ON playlist_folders;

CREATE POLICY "playlist_folders_owner"
  ON playlist_folders FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- 2. Composite index covers the WHERE user_id = $1 filter from RLS and the
--    ORDER BY sort_order that listFolders() applies, in a single index scan.
CREATE INDEX IF NOT EXISTS idx_playlist_folders_user
  ON playlist_folders (user_id, sort_order);

-- 3. Add updated_at (consistent with matches, playlists)
ALTER TABLE playlist_folders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER playlist_folders_updated_at
  BEFORE UPDATE ON playlist_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
