-- Scouting reports: the launch rules.
--
--   1. open_count: how often readers opened a report, counted by the page;
--   2. a free plan shares ONE live report at a time (publish refuses a second
--      with report_limit_reached and names the first; the share sheet asks
--      scouting_report_share_limit beforehand) instead of refusing every free
--      plan;
--   3. record_scouting_report_open, the page's counting door;
--   4. _take_down_scouting_report, a report taken down by the service role.
--
-- Every statement is safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Open counts
-- ---------------------------------------------------------------------------
-- How many times readers opened the report page, as counted by the page
-- (record_scouting_report_open). The owner reads it through the table's
-- existing read policy; no reader is identified, only the number is kept.
ALTER TABLE scouting_reports ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. The one free report
-- ---------------------------------------------------------------------------
-- The caller's live report that stops a new one on a free plan, or NULL:
-- {id, playlist_id, title, expires_at}. Live = not stopped, not expired, still
-- attached to a playlist, a playlist other than the one being published, and
-- billed to a free plan. The plan is read now, not when the report was
-- published, so the reports of a Pro that has lapsed count again.
CREATE OR REPLACE FUNCTION _scouting_report_blocker(p_uid uuid, p_playlist_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', r.id, 'playlist_id', r.playlist_id, 'title', r.title, 'expires_at', r.expires_at)
    FROM scouting_reports r
   WHERE r.user_id = p_uid AND r.revoked_at IS NULL AND r.expires_at > now()
     AND r.playlist_id IS NOT NULL AND r.playlist_id <> p_playlist_id
     AND _export_tier_for_playlist(r.playlist_id) = 'free'
   ORDER BY r.updated_at DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION _scouting_report_blocker(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Publishes the caller's playlist, or updates its live report in place (same
-- id, a fresh 30 days). Returns {id, expires_at, created}.
--
--   not_authenticated, not_owner, license_locked (the playlist's club is past
--   its grace, like every share), report_limit_reached (the playlist's plan is
--   free and the caller already shares another live report from a free plan;
--   DETAIL is that report as JSON: {id, playlist_id, title, expires_at}),
--   invalid_content.
--
-- What invalid_content means: version 1, an array of at most 60 sections each
-- with an array of blocks, at most 300 clips, every clip key a shipped clip
-- file's key and every poster key one of the caller's own highlights/<user>/
-- <uuid>.jpg files.
CREATE OR REPLACE FUNCTION publish_scouting_report(
  p_playlist_id uuid,
  p_title       text,
  p_content     jsonb,
  p_content_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_title     text := btrim(COALESCE(p_title, ''));
  v_org       uuid;
  v_blocker   jsonb;
  v_clip_keys text[];
  v_bad       integer;
  v_id        uuid;
  v_expires   timestamptz;
  v_created   boolean;
  v_clip_re   constant text := '^clips/[A-Za-z0-9-]{1,64}/[0-9]{1,12}_pre-?[0-9]{1,4}\.[0-9]_post-?[0-9]{1,4}\.[0-9](_s[0-9]{1,6}\.[0-9])?\.mp4$';
  v_uuid      constant text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM playlists WHERE id = p_playlist_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  v_org := _playlist_club_org(p_playlist_id);
  IF v_org IS NOT NULL AND org_license_state(v_org) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;

  -- A free plan shares one live report at a time. The lock keeps two publishes
  -- at once from both passing the check.
  IF _export_tier_for_playlist(p_playlist_id) = 'free' THEN
    PERFORM pg_advisory_xact_lock(hashtext('publish_scouting_report:' || v_uid::text));
    v_blocker := _scouting_report_blocker(v_uid, p_playlist_id);
    IF v_blocker IS NOT NULL THEN
      RAISE EXCEPTION 'report_limit_reached' USING DETAIL = v_blocker::text;
    END IF;
  END IF;

  -- Shape. The sections and their blocks are checked as arrays before they
  -- are expanded, so a malformed body is invalid_content, not a stray error.
  IF char_length(v_title) NOT BETWEEN 1 AND 120
     OR p_content_key IS NULL OR char_length(p_content_key) NOT BETWEEN 1 AND 64
     OR p_content IS NULL OR jsonb_typeof(p_content) <> 'object'
     OR octet_length(p_content::text) > 262144
     OR p_content->>'v' IS DISTINCT FROM '1'
     OR jsonb_typeof(p_content->'header') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_content->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_content->'sections') > 60 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s
   WHERE jsonb_typeof(s) IS DISTINCT FROM 'object'
      OR jsonb_typeof(s->'blocks') IS DISTINCT FROM 'array';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  -- Clips: at most 300, each with a key of the shape presign-upload admits.
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip';
  IF v_bad > 300 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip'
     AND (jsonb_typeof(b->'clipKey') IS DISTINCT FROM 'string' OR (b->>'clipKey') !~ v_clip_re);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  -- Posters: absent, null, or the caller's own highlights/<user>/<uuid>.jpg.
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip'
     AND (b ? 'posterKey')
     AND jsonb_typeof(b->'posterKey') <> 'null'
     AND (jsonb_typeof(b->'posterKey') <> 'string'
          OR (b->>'posterKey') !~ ('^highlights/' || v_uid::text || '/' || v_uuid || '\.jpg$'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b->>'clipKey'), '{}') INTO v_clip_keys
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip';

  INSERT INTO scouting_reports AS r (user_id, playlist_id, title, content, content_key, clip_keys, expires_at)
  VALUES (v_uid, p_playlist_id, v_title, p_content, p_content_key, v_clip_keys, now() + interval '30 days')
  ON CONFLICT (playlist_id) WHERE revoked_at IS NULL AND playlist_id IS NOT NULL
  DO UPDATE SET title       = EXCLUDED.title,
                content     = EXCLUDED.content,
                content_key = EXCLUDED.content_key,
                clip_keys   = EXCLUDED.clip_keys,
                updated_at  = now(),
                expires_at  = EXCLUDED.expires_at
          WHERE r.user_id = v_uid
  RETURNING r.id, r.expires_at, (r.xmax = 0) INTO v_id, v_expires, v_created;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'expires_at', v_expires, 'created', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_scouting_report(uuid, text, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION publish_scouting_report(uuid, text, jsonb, text) FROM PUBLIC, anon;

-- What the share sheet asks before it offers to publish: is the playlist on a
-- free plan (limited), and which live report of the caller's stands in the way
-- (blocked_by, null when none). {limited, blocked_by}.
--
--   not_authenticated, not_owner.
CREATE OR REPLACE FUNCTION scouting_report_share_limit(p_playlist_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_limited boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM playlists WHERE id = p_playlist_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  v_limited := _export_tier_for_playlist(p_playlist_id) = 'free';

  RETURN jsonb_build_object(
    'limited', v_limited,
    'blocked_by', CASE WHEN v_limited THEN _scouting_report_blocker(v_uid, p_playlist_id) END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION scouting_report_share_limit(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION scouting_report_share_limit(uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. Counting opens
-- ---------------------------------------------------------------------------
-- The page calls this when a reader opens a live report; an expired, stopped
-- or unknown id changes nothing. The owner's own opens while signed in are not
-- counted (auth.uid() is NULL for a reader without an account, so those still
-- count). updated_at is left alone (it is the report's "up to date"). Anyone
-- holding the link can bump the number; the only harm is a larger number shown
-- to the coach.
CREATE OR REPLACE FUNCTION record_scouting_report_open(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE scouting_reports
     SET open_count = open_count + 1
   WHERE id = p_id AND revoked_at IS NULL AND expires_at > now()
     AND user_id IS DISTINCT FROM auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION record_scouting_report_open(uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_scouting_report_open(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Taking a report down
-- ---------------------------------------------------------------------------
-- revoke_scouting_report without the owner check, for a named player's request
-- to hello@scoutable.se; run from the SQL editor (docs/scouting-reports.md).
-- Returns 'taken_down', 'already_off' (it was stopped before) or 'not_found'.
-- Like a revoke: the content is wiped at once, the clip files are queued for
-- the purge.
CREATE OR REPLACE FUNCTION _take_down_scouting_report(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revoked timestamptz;
  v_keys    text[];
BEGIN
  SELECT revoked_at, clip_keys INTO v_revoked, v_keys
    FROM scouting_reports
   WHERE id = p_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_revoked IS NOT NULL THEN
    RETURN 'already_off';
  END IF;

  UPDATE scouting_reports
     SET revoked_at = now(), updated_at = now(), content = '{}'::jsonb, clip_keys = '{}'
   WHERE id = p_id;

  PERFORM _queue_media_deletion(k, 'cleared') FROM unnest(v_keys) AS k;
  RETURN 'taken_down';
END;
$$;

REVOKE ALL ON FUNCTION _take_down_scouting_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _take_down_scouting_report(uuid) TO service_role;
