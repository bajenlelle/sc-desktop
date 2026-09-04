-- =============================================================================
-- Close the personal-org gap + finish the org backfill sweep.
--
-- 20260505000008 backfilled personal orgs only for users with NO org
-- memberships; users already in a club were skipped and never got one (17
-- users). They have no personal space, and the playlist org-scope backfill
-- (20260908100000) couldn't re-home their unresolvable playlists/folders.
--
-- Sweep order matters because of the same-org guards added in
-- 20260908100000: a NULL playlist inside an org'd folder must inherit the
-- FOLDER's org (folder_org_mismatch fires otherwise), so folder-derived
-- assignment runs before the personal-org fallback. All statements
-- idempotent — safe to re-run as the stale-desktop-client sweep later.
-- =============================================================================

-- 1. Every user gets a personal org (same shape as handle_new_user).
DO $$
DECLARE v_user RECORD; v_org_id uuid;
BEGIN
  FOR v_user IN
    SELECT p.id, p.full_name
    FROM profiles p
    WHERE NOT EXISTS (
      SELECT 1
      FROM org_memberships om
      JOIN organizations o ON o.id = om.org_id
      WHERE om.user_id = p.id AND o.is_personal
    )
  LOOP
    INSERT INTO organizations (name, is_personal)
    VALUES (COALESCE(NULLIF(TRIM(v_user.full_name), ''), 'Personal'), true)
    RETURNING id INTO v_org_id;
    INSERT INTO org_memberships (org_id, user_id, role)
    VALUES (v_org_id, v_user.id, 'admin');
  END LOOP;
END;
$$;

-- 2. NULL folders: inherit the modal org of contained playlists, then
--    propagate through the tree until fixpoint (same loop as 20260908100000).
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

DO $$
DECLARE v_up int; v_down int;
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

-- 3. Remaining NULL folders live in fully-unresolved trees: personal org.
--    (Parent and child resolve to the same personal org — same owner — so
--    the parent_org_mismatch guard stays satisfied.)
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

-- 4. NULL playlists inside an org'd folder inherit the folder's org —
--    required by folder_org_mismatch, and semantically right: the folder's
--    space is where the user filed them.
UPDATE playlists p
SET org_id = f.org_id
FROM playlist_folders f
WHERE p.folder_id = f.id
  AND p.org_id IS NULL
  AND f.org_id IS NOT NULL;

-- 5. Remaining NULL playlists (no folder): personal org.
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

-- 6. Matches sweep (no triggers involved).
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
