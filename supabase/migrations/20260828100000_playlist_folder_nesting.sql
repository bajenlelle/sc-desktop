-- =============================================================================
-- Nested playlist folders
--   1. parent_id self-FK, ON DELETE CASCADE — the app's folder delete is
--      subtree delete, so one DELETE on the root is atomic and correct;
--      playlists.folder_id ON DELETE SET NULL already moves every contained
--      playlist to Uncategorized.
--   2. FK index (cascade deletes and tree reads scan children by parent_id).
--   3. Trigger guard: no cycles (a persisted cycle would make rows invisible
--      in the UI), and the parent must belong to the same user — the owner
--      RLS policy only checks the written row, not what parent_id points at.
-- =============================================================================

ALTER TABLE playlist_folders
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES playlist_folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_playlist_folders_parent
  ON playlist_folders (parent_id);

CREATE OR REPLACE FUNCTION playlist_folders_check_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner    uuid;
  v_ancestor uuid;
  v_hops     int := 0;
BEGIN
  IF new.parent_id IS NULL THEN
    RETURN new;
  END IF;
  IF new.parent_id = new.id THEN
    RAISE EXCEPTION 'folder_cycle';
  END IF;

  SELECT user_id INTO v_owner FROM playlist_folders WHERE id = new.parent_id;
  IF v_owner IS NULL OR v_owner <> new.user_id THEN
    RAISE EXCEPTION 'parent_not_owned';
  END IF;

  v_ancestor := new.parent_id;
  WHILE v_ancestor IS NOT NULL LOOP
    v_hops := v_hops + 1;
    IF v_hops > 100 THEN
      RAISE EXCEPTION 'folder_too_deep';
    END IF;
    SELECT parent_id INTO v_ancestor FROM playlist_folders WHERE id = v_ancestor;
    IF v_ancestor = new.id THEN
      RAISE EXCEPTION 'folder_cycle';
    END IF;
  END LOOP;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS playlist_folders_parent_guard ON playlist_folders;
CREATE TRIGGER playlist_folders_parent_guard
  BEFORE INSERT OR UPDATE OF parent_id ON playlist_folders
  FOR EACH ROW EXECUTE FUNCTION playlist_folders_check_parent();
