-- Move content from a personal space into a club.
--
-- A coach who started alone has games and playlists in their personal space
-- and later joins or creates a club. move_to_club() moves the chosen games,
-- playlists and folders into a club where they're a coach or admin. It's a
-- move, not a copy, it only goes personal → club, and it can't be undone.
--
-- Content belongs to its creator (user_id); org_id only decides which space
-- lists a row, so a move rewrites org_id and keeps every id. R2 keys carry no
-- org id, so clip files, local video paths and highlight links keep working.
-- What needs care, all in one transaction:
--   * a moved playlist takes along the caller's own games its clips use;
--   * labels are a per-space vocabulary, so used labels are recreated by name
--     in the club and the assignments follow;
--   * folders must stay within one space (playlist_folders_check_parent,
--     playlists_check_folder_org check row by row), so the needed folder
--     paths are recreated by name in the club, reusing same-named folders,
--     and the moved personal folders are deleted afterwards;
--   * when the club already has the caller's copy of the same game
--     (source_game_id), the clips merge into that copy and the personal copy
--     is deleted, but only when that can't misplace anything (see
--     _move_to_club_merge_target); otherwise the game moves as a second copy.
-- import_log is untouched: no refund for the personal space, no charge for
-- the club. "Personal" means the caller's personal org or a legacy NULL
-- org_id, which is what the personal space lists (includeUnscoped).

-- ---------------------------------------------------------------------------
-- Audit trail: one row per move, for support. Server-written only.
-- ---------------------------------------------------------------------------
CREATE TABLE space_moves (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_org_id        uuid REFERENCES organizations(id) ON DELETE SET NULL,
  to_org_id          uuid REFERENCES organizations(id) ON DELETE SET NULL,
  match_ids          text[] NOT NULL DEFAULT '{}',
  merged             jsonb  NOT NULL DEFAULT '{}',
  playlist_ids       uuid[] NOT NULL DEFAULT '{}',
  removed_folder_ids uuid[] NOT NULL DEFAULT '{}',
  counts             jsonb  NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX space_moves_user_idx ON space_moves (user_id, created_at DESC);

ALTER TABLE space_moves ENABLE ROW LEVEL SECURITY;

-- Default privileges hand new tables to anon/authenticated; this one is for
-- the service role only.
REVOKE ALL ON TABLE space_moves FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE space_moves TO service_role;

-- ---------------------------------------------------------------------------
-- Gate shared by the preview and the move. Returns the caller's personal org.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _move_to_club_gate(p_uid uuid, p_target uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_personal uuid;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations
    WHERE id = p_target AND NOT COALESCE(is_personal, false)
  ) THEN
    RAISE EXCEPTION 'target_not_club';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = p_uid AND org_id = p_target AND role IN ('admin', 'coach')
  ) THEN
    RAISE EXCEPTION 'not_staff';
  END IF;

  -- Moving in would otherwise get around the import lock, which only checks
  -- INSERT (enforce_license_on_import).
  IF org_license_state(p_target) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;

  SELECT om.org_id INTO v_personal
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = p_uid AND o.is_personal
  ORDER BY om.joined_at
  LIMIT 1;

  IF v_personal IS NULL THEN
    RAISE EXCEPTION 'no_personal_space';
  END IF;

  RETURN v_personal;
END;
$$;

REVOKE ALL ON FUNCTION _move_to_club_gate(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Is there a club copy of this game to merge into, and is merging safe?
--
-- The club copy is the caller's newest non-demo game in the club with the
-- same source_game_id (what the import dedupe, findMatchBySourceGame, finds).
-- Merging repoints clips by (match_id, event_id), so it's only safe when:
--   * both copies take their plays from the same source: stat-keeper imports
--     keep the official source_game_id but number events from the session;
--   * every event a clip uses exists in the club copy as the same play;
--   * the video can't shift: crop keyframes are stored in source-video
--     seconds, so two different files, or one file synced differently,
--     would quietly misplace them.
-- No row = no club copy. A row with mergeable = false moves as a second copy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _move_to_club_merge_target(p_uid uuid, p_target uuid, p_match_id text)
RETURNS TABLE (club_match_id text, mergeable boolean, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m matches%ROWTYPE;
  c matches%ROWTYPE;
BEGIN
  SELECT * INTO m FROM matches WHERE id = p_match_id;
  IF m.id IS NULL OR m.source_game_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO c FROM matches
  WHERE user_id = p_uid
    AND org_id = p_target
    AND source_game_id = m.source_game_id
    AND NOT is_demo
    AND id <> m.id
  ORDER BY created_at DESC
  LIMIT 1;
  IF c.id IS NULL THEN
    RETURN;
  END IF;

  club_match_id := c.id;

  IF m.stats_session_id IS DISTINCT FROM c.stats_session_id THEN
    mergeable := false;
    reason := 'stats_source_differs';
  ELSIF EXISTS (
    SELECT 1
    FROM playlist_clips pc
    JOIN play_by_play_events pe ON pe.match_id = m.id AND pe.event_id = pc.event_id
    LEFT JOIN play_by_play_events ce ON ce.match_id = c.id AND ce.event_id = pc.event_id
    WHERE pc.match_id = m.id
      AND (ce.id IS NULL OR ce.type IS DISTINCT FROM pe.type OR ce.period IS DISTINCT FROM pe.period)
  ) THEN
    mergeable := false;
    reason := 'plays_differ';
  ELSIF m.video_url IS NOT NULL AND c.video_url IS NOT NULL
        AND (m.video_url <> c.video_url
             OR (m.sync_point IS NOT NULL AND c.sync_point IS NOT NULL AND m.sync_point <> c.sync_point)) THEN
    mergeable := false;
    reason := 'video_differs';
  ELSE
    mergeable := true;
    reason := NULL;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION _move_to_club_merge_target(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the picker lists: the caller's personal folders, playlists and
-- non-demo games, with what would happen to each game.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_move_to_club_preview(p_target_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := (SELECT auth.uid());
  v_personal uuid;
  v_target   jsonb;
  v_folders  jsonb;
  v_lists    jsonb;
  v_games    jsonb;
BEGIN
  v_personal := _move_to_club_gate(v_uid, p_target_org);

  SELECT jsonb_build_object(
           'org_id', o.id,
           'name', o.name,
           'plan_tier', o.plan_tier,
           'license_state', org_license_state(o.id))
    INTO v_target
  FROM organizations o WHERE o.id = p_target_org;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', f.id,
           'name', f.name,
           'parent_id', f.parent_id,
           'sort_order', f.sort_order)
         ORDER BY f.sort_order, f.created_at), '[]'::jsonb)
    INTO v_folders
  FROM playlist_folders f
  WHERE f.user_id = v_uid AND (f.org_id = v_personal OR f.org_id IS NULL);

  -- match_ids: the games that would move with the playlist. demo_clip_count
  -- and other_space_clip_count: clips whose game stays where it is.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'folder_id', p.folder_id,
           'created_at', p.created_at,
           'clip_count', s.clip_count,
           'match_ids', s.match_ids,
           'demo_clip_count', s.demo_clip_count,
           'other_space_clip_count', s.other_space_clip_count,
           'shared', p.team_id IS NOT NULL
                     OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id)
                     OR EXISTS (SELECT 1 FROM playlist_user_shares us WHERE us.playlist_id = p.id))
         ORDER BY p.created_at DESC), '[]'::jsonb)
    INTO v_lists
  FROM playlists p
  CROSS JOIN LATERAL (
    SELECT
      count(pc.id) FILTER (WHERE pc.match_id IS NOT NULL) AS clip_count,
      COALESCE(jsonb_agg(DISTINCT pc.match_id) FILTER (
        WHERE m.user_id = v_uid AND (m.org_id = v_personal OR m.org_id IS NULL) AND NOT m.is_demo
      ), '[]'::jsonb) AS match_ids,
      count(pc.id) FILTER (WHERE m.is_demo) AS demo_clip_count,
      count(pc.id) FILTER (
        WHERE pc.match_id IS NOT NULL AND NOT m.is_demo
          AND (m.user_id <> v_uid OR (m.org_id IS NOT NULL AND m.org_id <> v_personal))
      ) AS other_space_clip_count
    FROM playlist_clips pc
    LEFT JOIN matches m ON m.id = pc.match_id
    WHERE pc.playlist_id = p.id
  ) s
  WHERE p.user_id = v_uid AND (p.org_id = v_personal OR p.org_id IS NULL);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'title', m.title,
           'game_date', m.game_date,
           'home', m.home_team->>'name',
           'away', m.away_team->>'name',
           'created_at', m.created_at,
           'duplicate', CASE WHEN t.club_match_id IS NULL THEN NULL ELSE jsonb_build_object(
             'club_match_id', t.club_match_id,
             'mergeable', t.mergeable,
             'reason', t.reason) END)
         ORDER BY m.game_date DESC NULLS LAST, m.created_at DESC), '[]'::jsonb)
    INTO v_games
  FROM matches m
  LEFT JOIN LATERAL _move_to_club_merge_target(v_uid, p_target_org, m.id) t ON true
  WHERE m.user_id = v_uid AND (m.org_id = v_personal OR m.org_id IS NULL) AND NOT m.is_demo;

  RETURN jsonb_build_object(
    'personal_org_id', v_personal,
    'target', v_target,
    'folders', v_folders,
    'playlists', v_lists,
    'games', v_games);
END;
$$;

REVOKE ALL ON FUNCTION get_move_to_club_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_move_to_club_preview(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- The move. All or nothing: any error rolls everything back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION move_to_club(
  p_target_org   uuid,
  p_match_ids    text[] DEFAULT '{}',
  p_playlist_ids uuid[] DEFAULT '{}',
  p_folder_ids   uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := (SELECT auth.uid());
  v_personal     uuid;
  v_match_ids    text[];
  v_playlist_ids uuid[];
  v_folder_ids   uuid[];
  v_folders      uuid[];  -- selected personal folders and their subtrees
  v_need         uuid[];  -- personal folders whose path the club needs
  v_playlists    uuid[];
  v_matches      text[];
  v_move         text[] := '{}';
  v_merge        jsonb  := '{}';  -- personal match id → club match id
  v_separate     jsonb  := '[]';
  v_fmap         jsonb  := '{}';  -- personal folder id → club folder id
  v_parent       uuid;
  v_club_folder  uuid;
  v_progress     boolean;
  v_n            integer;
  v_labels_created      integer := 0;
  v_assignments_moved   integer := 0;
  v_folders_created     integer := 0;
  v_folders_reused      integer := 0;
  v_shares_removed      integer := 0;
  v_clips_repointed     integer := 0;
  v_move_id      uuid;
  v_counts       jsonb;
  r              record;
BEGIN
  v_personal := _move_to_club_gate(v_uid, p_target_org);

  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_match_ids
  FROM unnest(COALESCE(p_match_ids, '{}')) x WHERE x IS NOT NULL;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_playlist_ids
  FROM unnest(COALESCE(p_playlist_ids, '{}')) x WHERE x IS NOT NULL;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_folder_ids
  FROM unnest(COALESCE(p_folder_ids, '{}')) x WHERE x IS NOT NULL;

  IF cardinality(v_match_ids) + cardinality(v_playlist_ids) + cardinality(v_folder_ids) = 0 THEN
    RAISE EXCEPTION 'nothing_to_move';
  END IF;
  -- Keeps one call well inside the 8 s statement timeout.
  IF cardinality(v_match_ids) > 500 OR cardinality(v_playlist_ids) > 1000 OR cardinality(v_folder_ids) > 500 THEN
    RAISE EXCEPTION 'too_many';
  END IF;

  -- One move per user at a time: two tabs moving overlapping content would
  -- otherwise mirror the same folders twice.
  PERFORM pg_advisory_xact_lock(hashtext('move_to_club:' || v_uid::text));

  -- 1. Every id asked for must be the caller's and in their personal space.
  IF EXISTS (
    SELECT 1 FROM unnest(v_match_ids) AS x(id)
    LEFT JOIN matches m ON m.id = x.id
    WHERE m.id IS NULL OR m.user_id <> v_uid OR (m.org_id IS NOT NULL AND m.org_id <> v_personal)
  ) OR EXISTS (
    SELECT 1 FROM unnest(v_playlist_ids) AS x(id)
    LEFT JOIN playlists p ON p.id = x.id
    WHERE p.id IS NULL OR p.user_id <> v_uid OR (p.org_id IS NOT NULL AND p.org_id <> v_personal)
  ) OR EXISTS (
    SELECT 1 FROM unnest(v_folder_ids) AS x(id)
    LEFT JOIN playlist_folders f ON f.id = x.id
    WHERE f.id IS NULL OR f.user_id <> v_uid OR (f.org_id IS NOT NULL AND f.org_id <> v_personal)
  ) THEN
    RAISE EXCEPTION 'not_movable';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE id = ANY(v_match_ids) AND is_demo) THEN
    RAISE EXCEPTION 'demo_not_movable';
  END IF;

  -- 2. Expand: folders → subtrees → their playlists → the playlists' games.
  WITH RECURSIVE sub AS (
    SELECT id FROM playlist_folders WHERE id = ANY(v_folder_ids)
    UNION
    SELECT f.id FROM playlist_folders f JOIN sub ON f.parent_id = sub.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_folders FROM sub;

  -- The subtree is deleted at the end, so it must not hold anything that
  -- isn't moving with it.
  IF EXISTS (
    SELECT 1 FROM playlist_folders
    WHERE id = ANY(v_folders)
      AND (user_id <> v_uid OR (org_id IS NOT NULL AND org_id <> v_personal))
  ) OR EXISTS (
    SELECT 1 FROM playlists
    WHERE folder_id = ANY(v_folders)
      AND (user_id <> v_uid OR (org_id IS NOT NULL AND org_id <> v_personal))
  ) THEN
    RAISE EXCEPTION 'folder_has_other_space_content';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), '{}') INTO v_playlists
  FROM playlists
  WHERE id = ANY(v_playlist_ids) OR folder_id = ANY(v_folders);

  -- Only the caller's own personal games come along; a clip on a demo game or
  -- a game in another space keeps pointing where it does.
  SELECT COALESCE(array_agg(DISTINCT m.id), '{}') INTO v_matches
  FROM matches m
  WHERE (m.id = ANY(v_match_ids)
         OR m.id IN (SELECT pc.match_id FROM playlist_clips pc WHERE pc.playlist_id = ANY(v_playlists)))
    AND m.user_id = v_uid
    AND (m.org_id = v_personal OR m.org_id IS NULL)
    AND NOT m.is_demo;

  PERFORM 1 FROM matches WHERE id = ANY(v_matches) FOR UPDATE;
  PERFORM 1 FROM playlists WHERE id = ANY(v_playlists) FOR UPDATE;
  PERFORM 1 FROM playlist_folders WHERE id = ANY(v_folders) FOR UPDATE;

  -- 3. Classify each game: merge into the club copy, or move.
  FOR r IN
    SELECT x.id, t.club_match_id, t.mergeable, t.reason
    FROM unnest(v_matches) AS x(id)
    LEFT JOIN LATERAL _move_to_club_merge_target(v_uid, p_target_org, x.id) t ON true
  LOOP
    IF r.club_match_id IS NOT NULL AND r.mergeable THEN
      v_merge := v_merge || jsonb_build_object(r.id, r.club_match_id);
    ELSE
      v_move := v_move || r.id;
      IF r.club_match_id IS NOT NULL THEN
        v_separate := v_separate || jsonb_build_array(jsonb_build_object(
          'match_id', r.id, 'club_match_id', r.club_match_id, 'reason', r.reason));
      END IF;
    END IF;
  END LOOP;

  -- 4. Labels. The caller's assignments on the moving games (bank scope) and
  --    in the moving playlists (playlist scope) are recreated in the club
  --    against same-named club labels, created where missing. The personal
  --    vocabulary stays as it is.
  INSERT INTO labels (user_id, org_id, name, color)
  SELECT DISTINCT ON (lower(l.name)) v_uid, p_target_org, l.name, l.color
  FROM labels l
  WHERE l.id IN (
    SELECT a.label_id FROM clip_label_assignments a
    WHERE a.user_id = v_uid AND a.org_id <> p_target_org
      AND ((a.playlist_id IS NULL AND a.match_id = ANY(v_matches)) OR a.playlist_id = ANY(v_playlists))
  )
  ORDER BY lower(l.name), l.created_at
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_labels_created = ROW_COUNT;

  INSERT INTO clip_label_assignments (user_id, org_id, match_id, event_id, label_id, playlist_id, assigned_at)
  SELECT a.user_id, p_target_org, COALESCE(v_merge->>a.match_id, a.match_id), a.event_id, tl.id,
         a.playlist_id, a.assigned_at
  FROM clip_label_assignments a
  JOIN labels sl ON sl.id = a.label_id
  JOIN labels tl ON tl.user_id = v_uid AND tl.org_id = p_target_org AND lower(tl.name) = lower(sl.name)
  WHERE a.user_id = v_uid AND a.org_id <> p_target_org
    AND ((a.playlist_id IS NULL AND a.match_id = ANY(v_matches)) OR a.playlist_id = ANY(v_playlists))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_assignments_moved = ROW_COUNT;

  DELETE FROM clip_label_assignments a
  WHERE a.user_id = v_uid AND a.org_id <> p_target_org
    AND ((a.playlist_id IS NULL AND a.match_id = ANY(v_matches)) OR a.playlist_id = ANY(v_playlists));

  -- 5. Folders: recreate every needed path in the club, top-down, reusing a
  --    same-named folder under the same club parent. Needed = the moving
  --    subtrees, the moving playlists' folders and all their ancestors.
  WITH RECURSIVE need AS (
    SELECT f.id, f.parent_id FROM playlist_folders f
    WHERE f.id = ANY(v_folders)
       OR f.id IN (SELECT folder_id FROM playlists WHERE id = ANY(v_playlists) AND folder_id IS NOT NULL)
    UNION
    SELECT p.id, p.parent_id FROM playlist_folders p JOIN need n ON p.id = n.parent_id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_need FROM need;

  LOOP
    v_progress := false;
    FOR r IN
      SELECT f.id, f.name, f.parent_id, f.sort_order
      FROM playlist_folders f
      WHERE f.id = ANY(v_need)
        AND NOT (v_fmap ? f.id::text)
        AND (f.parent_id IS NULL OR v_fmap ? f.parent_id::text)
      ORDER BY f.sort_order, f.created_at
    LOOP
      v_parent := (v_fmap->>r.parent_id::text)::uuid;
      SELECT id INTO v_club_folder
      FROM playlist_folders
      WHERE user_id = v_uid
        AND org_id = p_target_org
        AND parent_id IS NOT DISTINCT FROM v_parent
        AND lower(btrim(name)) = lower(btrim(r.name))
      ORDER BY created_at
      LIMIT 1;
      IF v_club_folder IS NULL THEN
        INSERT INTO playlist_folders (user_id, org_id, name, sort_order, parent_id)
        VALUES (v_uid, p_target_org, r.name, r.sort_order, v_parent)
        RETURNING id INTO v_club_folder;
        v_folders_created := v_folders_created + 1;
      ELSE
        v_folders_reused := v_folders_reused + 1;
      END IF;
      v_fmap := v_fmap || jsonb_build_object(r.id::text, v_club_folder);
      v_progress := true;
    END LOOP;
    EXIT WHEN NOT v_progress;
  END LOOP;

  -- 6. Playlists. A folder that couldn't be mirrored (its parent sits in
  --    another space) leaves the playlist unfiled rather than failing.
  --    Personal playlists can't be shared, so clearing team_id and the share
  --    rows only catches rows from before that rule.
  UPDATE playlists p
  SET org_id    = p_target_org,
      folder_id = CASE WHEN p.folder_id IS NULL THEN NULL ELSE (v_fmap->>p.folder_id::text)::uuid END,
      team_id   = NULL
  WHERE p.id = ANY(v_playlists);

  DELETE FROM playlist_shares WHERE playlist_id = ANY(v_playlists);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_shares_removed := v_n;
  DELETE FROM playlist_user_shares WHERE playlist_id = ANY(v_playlists);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_shares_removed := v_shares_removed + v_n;

  -- 7. Merges. Every clip on the personal copy moves to the club copy, in
  --    any playlist, including personal ones that stay behind: deleting the
  --    personal copy would otherwise cascade them away. r2_url stays as it
  --    is; those clip files are keyed by the old id and still exist.
  FOR r IN SELECT key AS m, value #>> '{}' AS c FROM jsonb_each(v_merge)
  LOOP
    -- A playlist holding the same play from both copies keeps the club row.
    DELETE FROM playlist_clips pc
    WHERE pc.match_id = r.m
      AND EXISTS (
        SELECT 1 FROM playlist_clips o
        WHERE o.playlist_id = pc.playlist_id AND o.match_id = r.c AND o.event_id = pc.event_id
      );

    UPDATE playlist_clips SET match_id = r.c WHERE match_id = r.m;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_clips_repointed := v_clips_repointed + v_n;

    -- Stats cards name their game in the spec.
    UPDATE playlist_clips
    SET card = jsonb_set(card, '{game,matchId}', to_jsonb(r.c))
    WHERE item_type = 'text' AND card #>> '{game,matchId}' = r.m;

    UPDATE clip_views v SET match_id = r.c
    WHERE v.match_id = r.m
      AND NOT EXISTS (
        SELECT 1 FROM clip_views o
        WHERE o.user_id = v.user_id AND o.playlist_id = v.playlist_id
          AND o.match_id = r.c AND o.event_id = v.event_id
      );

    -- Assignments left on the personal copy belong to personal playlists
    -- that stay behind; they keep their space and label.
    UPDATE clip_label_assignments a SET match_id = r.c
    WHERE a.match_id = r.m
      AND NOT EXISTS (
        SELECT 1 FROM clip_label_assignments o
        WHERE o.user_id = a.user_id AND o.org_id = a.org_id AND o.match_id = r.c
          AND o.event_id = a.event_id AND o.label_id = a.label_id
          AND o.playlist_id IS NOT DISTINCT FROM a.playlist_id
      );

    -- The club copy keeps its video and sync; it takes the personal copy's
    -- where it has none (a club copy without video, or the same file unsynced).
    UPDATE matches c
    SET video_url  = COALESCE(c.video_url, pm.video_url),
        sync_point = CASE
                       WHEN c.video_url IS NULL AND pm.video_url IS NOT NULL THEN COALESCE(pm.sync_point, c.sync_point)
                       WHEN c.video_url = pm.video_url THEN COALESCE(c.sync_point, pm.sync_point)
                       ELSE c.sync_point
                     END
    FROM matches pm
    WHERE c.id = r.c AND pm.id = r.m
      AND (c.video_url IS NULL OR c.sync_point IS NULL);

    IF EXISTS (SELECT 1 FROM playlist_clips WHERE match_id = r.m) THEN
      RAISE EXCEPTION 'merge_incomplete';
    END IF;

    DELETE FROM matches WHERE id = r.m;
  END LOOP;

  -- 8. Games. Only INSERT triggers guard imports and licences, so none fire.
  UPDATE matches SET org_id = p_target_org WHERE id = ANY(v_move);

  -- 9. The moved personal folders, now empty of playlists.
  DELETE FROM playlist_folders WHERE id = ANY(v_folders);

  v_counts := jsonb_build_object(
    'games_moved', cardinality(v_move),
    'games_merged', (SELECT count(*) FROM jsonb_object_keys(v_merge)),
    'games_kept_separate', jsonb_array_length(v_separate),
    'playlists_moved', cardinality(v_playlists),
    'folders_created', v_folders_created,
    'folders_reused', v_folders_reused,
    'folders_removed', cardinality(v_folders),
    'labels_created', v_labels_created,
    'label_assignments_moved', v_assignments_moved,
    'clips_repointed', v_clips_repointed,
    'shares_removed', v_shares_removed);

  INSERT INTO space_moves (user_id, from_org_id, to_org_id, match_ids, merged, playlist_ids, removed_folder_ids, counts)
  VALUES (v_uid, v_personal, p_target_org, v_matches, v_merge, v_playlists, v_folders, v_counts)
  RETURNING id INTO v_move_id;

  RETURN v_counts || jsonb_build_object(
    'move_id', v_move_id,
    'merged', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', key, 'to', value #>> '{}')), '[]'::jsonb)
               FROM jsonb_each(v_merge)),
    'separate', v_separate);
END;
$$;

REVOKE ALL ON FUNCTION move_to_club(uuid, text[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION move_to_club(uuid, text[], uuid[], uuid[]) TO authenticated;
