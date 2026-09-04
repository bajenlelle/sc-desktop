-- =============================================================================
-- Org-scope playlists & playlist_folders
--
-- Spaces must isolate content: matches have carried org_id since
-- 20260505000006, but playlists/folders never did, so a coach's club
-- playlists showed up in their personal space (and vice versa).
--
-- Model follows matches exactly: org_id is a nullable FILTER column set by
-- clients; RLS stays user/share-based and is deliberately untouched
-- (playlists_owner + playlists_read via current_user_visible_playlist_ids
-- remain the permission layer).
--
-- Sweep note: desktop clients older than the release shipping this change
-- insert rows with org_id NULL. Readers surface those in the owner's
-- personal space (includeUnscoped in shared/lib), and a later migration can
-- re-run the two personal-org fallback UPDATEs below verbatim to re-home
-- them permanently.
-- =============================================================================

-- 1. Latent-bug fix: matches imported before personal orgs existed still have
--    org_id NULL, which makes them invisible in EVERY space (list queries
--    filter by org). Home them in the owner's personal org.
UPDATE matches m
SET org_id = po.org_id
FROM (
  SELECT om.user_id, om.org_id
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE o.is_personal
) po
WHERE m.user_id = po.user_id
  AND m.org_id IS NULL;

-- 2. Columns. Nullable + ON DELETE SET NULL (matches precedent): content
--    belongs to the user and survives org deletion.
ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE playlist_folders
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- 3a. Backfill playlists: the modal org of the matches its clips reference
--     (ties broken deterministically by org id). Text-card rows have
--     match_id NULL and drop out via the join.
UPDATE playlists p
SET org_id = inf.org_id
FROM (
  SELECT DISTINCT ON (pc.playlist_id) pc.playlist_id, m.org_id
  FROM playlist_clips pc
  JOIN matches m ON m.id = pc.match_id
  WHERE m.org_id IS NOT NULL
  GROUP BY pc.playlist_id, m.org_id
  ORDER BY pc.playlist_id, count(*) DESC, m.org_id
) inf
WHERE p.id = inf.playlist_id
  AND p.org_id IS NULL;

-- 3b. Playlists with no inferable org (empty, or text cards only): the
--     owner's personal org.
UPDATE playlists p
SET org_id = po.org_id
FROM (
  SELECT om.user_id, om.org_id
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE o.is_personal
) po
WHERE p.user_id = po.user_id
  AND p.org_id IS NULL;

-- 4a. Backfill folders from directly-contained playlists (modal org).
UPDATE playlist_folders f
SET org_id = inf.org_id
FROM (
  SELECT DISTINCT ON (p.folder_id) p.folder_id, p.org_id
  FROM playlists p
  WHERE p.folder_id IS NOT NULL
    AND p.org_id IS NOT NULL
  GROUP BY p.folder_id, p.org_id
  ORDER BY p.folder_id, count(*) DESC, p.org_id
) inf
WHERE f.id = inf.folder_id
  AND f.org_id IS NULL;

-- 4b. Propagate through the tree until fixpoint: parents inherit from any
--     populated child, empty children inherit from their parent. (The
--     nesting trigger allows up to 100 levels, so no fixed pass count.)
DO $$
DECLARE
  v_up int;
  v_down int;
BEGIN
  LOOP
    UPDATE playlist_folders parent
    SET org_id = child.org_id
    FROM playlist_folders child
    WHERE child.parent_id = parent.id
      AND parent.org_id IS NULL
      AND child.org_id IS NOT NULL;
    GET DIAGNOSTICS v_up = ROW_COUNT;

    UPDATE playlist_folders child
    SET org_id = parent.org_id
    FROM playlist_folders parent
    WHERE child.parent_id = parent.id
      AND child.org_id IS NULL
      AND parent.org_id IS NOT NULL;
    GET DIAGNOSTICS v_down = ROW_COUNT;

    EXIT WHEN v_up + v_down = 0;
  END LOOP;
END;
$$;

-- 4c. Folders still without an org (empty trees): the owner's personal org.
UPDATE playlist_folders f
SET org_id = po.org_id
FROM (
  SELECT om.user_id, om.org_id
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE o.is_personal
) po
WHERE f.user_id = po.user_id
  AND f.org_id IS NULL;

-- 5. Indexes for the list queries (eq user_id + eq org_id, ordered).
--    idx_playlist_folders_user (user_id, sort_order) is prefix-covered by
--    the new composite and dropped.
CREATE INDEX IF NOT EXISTS idx_playlists_user_org_created
  ON playlists (user_id, org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playlist_folders_user_org
  ON playlist_folders (user_id, org_id, sort_order);
DROP INDEX IF EXISTS idx_playlist_folders_user;

-- 6a. Extend the folder parent guard: a child may not live in a different
--     org than its parent. NULL-lenient on either side so rows written by
--     pre-org desktop clients keep working until the sweep re-homes them.
CREATE OR REPLACE FUNCTION playlist_folders_check_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner      uuid;
  v_parent_org uuid;
  v_ancestor   uuid;
  v_hops       int := 0;
BEGIN
  IF new.parent_id IS NULL THEN
    RETURN new;
  END IF;
  IF new.parent_id = new.id THEN
    RAISE EXCEPTION 'folder_cycle';
  END IF;

  SELECT user_id, org_id INTO v_owner, v_parent_org
  FROM playlist_folders WHERE id = new.parent_id;
  IF v_owner IS NULL OR v_owner <> new.user_id THEN
    RAISE EXCEPTION 'parent_not_owned';
  END IF;
  IF v_parent_org IS NOT NULL AND new.org_id IS NOT NULL AND v_parent_org <> new.org_id THEN
    RAISE EXCEPTION 'parent_org_mismatch';
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
  BEFORE INSERT OR UPDATE OF parent_id, org_id ON playlist_folders
  FOR EACH ROW EXECUTE FUNCTION playlist_folders_check_parent();

-- 6b. A playlist may not sit in a folder from a different org. Same
--     NULL-leniency as above.
CREATE OR REPLACE FUNCTION playlists_check_folder_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_folder_org uuid;
BEGIN
  IF new.folder_id IS NULL THEN
    RETURN new;
  END IF;
  SELECT org_id INTO v_folder_org FROM playlist_folders WHERE id = new.folder_id;
  IF v_folder_org IS NOT NULL AND new.org_id IS NOT NULL AND v_folder_org <> new.org_id THEN
    RAISE EXCEPTION 'folder_org_mismatch';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS playlists_folder_org_guard ON playlists;
CREATE TRIGGER playlists_folder_org_guard
  BEFORE INSERT OR UPDATE OF folder_id, org_id ON playlists
  FOR EACH ROW EXECUTE FUNCTION playlists_check_folder_org();
