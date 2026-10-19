-- =============================================================================
-- 20261022100000: Cloud game videos, milestone 3c: the game's sync on the web,
-- and deleting superseded clip files.
--
-- 1. The tip-off lock. `_game_video_set_sync` (20261019200000) refused to
--    touch a sync the coach had set themselves (`sync_locked`), so after a
--    video was replaced the web could no longer move the tip-off to the new
--    recording. Now an explicit `manual` set by the video's uploader always
--    applies: it is their sync. `confirmed` keeps the old rule (it only ever
--    confirms what our converter found, never overrides a coach's own sync).
--    A copy without an anchor time of its own (the desktop's) keeps the
--    game's reference event and moves only its video time.
-- 2. Per-quarter syncs from the web, `_game_video_set_periods`: the uploader
--    writes the game's `periods` (a video that skips the breaks syncs each
--    quarter on its own; packages/shared/lib/period-sync.ts), and with them
--    `marks` and `breaksCut` when given, and the tip-off with rule 1's manual
--    set when given. The shape is checked here as the function checks it
--    (parseSyncPeriodsPayload in packages/shared/lib/game-video-wire.ts).
-- 3. Superseded clip files. A shipped clip is a file in the PUBLIC media
--    bucket (playlist_clips.r2_url). When the file a clip points at changes
--    (render_done cuts it again, a trim or a sync change clears it, the
--    desktop re-ships it), the old key is queued in `media_deletions` by a
--    trigger on playlist_clips, whoever made the change.
-- 4. The purge: the function's `media_purge` action (behind the purge
--    secret, nightly through run_game_video_purge) deletes a queued key only
--    when no playlist_clips.r2_url and no live ship job references it any
--    more: two playlists with the same clip and clip length share one file.
--    A key still referenced is dropped from the queue without deleting; it is
--    queued again when that clip changes too. Staging and prod share the
--    media bucket and staging holds copies of prod's rows, so the function
--    only deletes in its MEDIA_PURGE_SCOPE (smoke games by default, all clips
--    once the project that owns the bucket sets `all`).
--
-- Every helper is SECURITY DEFINER with search_path = public and REVOKEd from
-- PUBLIC, anon and authenticated: the function calls them with the service
-- role. Verified by supabase/tests/sync_media.sh and game_videos.sh.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The tip-off: the uploader's own `manual` always applies
-- ---------------------------------------------------------------------------
-- Re-created from 20261019200000. Writes the game's sync point (merging into
-- what is there, so quarter syncs and marks survive), a confirmed hint for
-- this recording (its own tip-off anchor, with a fingerprint), and the row's
-- sync status.
CREATE OR REPLACE FUNCTION _game_video_set_sync(
  p_video_id uuid,
  p_user     uuid,
  p_status   text,
  p_seconds  double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     game_videos%ROWTYPE;
  v_sync    jsonb;
  v_seconds double precision;
  v_anchor  jsonb;
  v_key     text;
  v_dur     integer;
  v_hashes  text[];
  v_bits    bit(64)[] := '{}';
  v_n       integer;
  v_source  text;
  i         integer;
BEGIN
  SELECT * INTO v_row FROM game_videos WHERE id = p_video_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.uploaded_by IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'ready' THEN RAISE EXCEPTION 'wrong_status'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('confirmed', 'manual') THEN RAISE EXCEPTION 'invalid_request'; END IF;
  v_seconds := COALESCE(p_seconds, v_row.suggested_tipoff_seconds);
  -- NaN sorts above every number in Postgres, so it fails the upper bound.
  IF v_seconds IS NULL OR v_seconds <= -3600 OR v_seconds >= 36000 THEN RAISE EXCEPTION 'invalid_request'; END IF;

  SELECT sync_point, source_game_id INTO v_sync, v_source FROM matches WHERE id = v_row.match_id FOR UPDATE;
  -- Confirming never overrides a coach's own sync; setting it by hand is the uploader's to do.
  IF p_status = 'confirmed'
     AND v_sync IS NOT NULL AND v_sync->>'syncVideoTime' IS NOT NULL
     AND COALESCE(v_row.sync_status, '') NOT IN ('applied', 'confirmed', 'manual') THEN
    RAISE EXCEPTION 'sync_locked';
  END IF;

  IF v_row.anchor_real_world_time IS NOT NULL THEN
    -- The recording's own anchor: the moment the time refers to. A tip-off
    -- anchor needs no label, so a stale one from another reference goes.
    v_anchor := CASE WHEN COALESCE(v_row.anchor_kind, 'tipoff') <> 'tipoff'
                     THEN jsonb_build_object('kind', v_row.anchor_kind, 'label', COALESCE(v_row.anchor_label, v_row.anchor_kind))
                END;
    UPDATE matches
       SET sync_point = (COALESCE(sync_point, '{}'::jsonb) - 'anchor')
                        || jsonb_build_object(
                             'syncVideoTime',     v_seconds,
                             'syncRealWorldTime', to_char(v_row.anchor_real_world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                        || CASE WHEN v_anchor IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('anchor', v_anchor) END
     WHERE id = v_row.match_id;
  ELSIF p_status = 'manual' AND COALESCE(v_sync->>'syncRealWorldTime', '') <> '' THEN
    -- A copy without an anchor of its own (the desktop uploads none): the
    -- game's reference event stays, only where it is in the video moves.
    UPDATE matches
       SET sync_point = sync_point || jsonb_build_object('syncVideoTime', v_seconds)
     WHERE id = v_row.match_id;
  ELSE
    RAISE EXCEPTION 'no_anchor';
  END IF;

  -- The confirmed hint: the same shape upsert_video_sync_hint writes, keyed
  -- on (fingerprint_key, detected_by). Only for the recording's own tip-off.
  IF v_row.anchor_real_world_time IS NOT NULL
     AND COALESCE(v_row.anchor_kind, 'tipoff') = 'tipoff'
     AND v_row.content_fingerprint IS NOT NULL THEN
    v_key := v_row.content_fingerprint->>'key';
    v_dur := NULLIF(v_row.content_fingerprint->>'durationMs', '')::integer;
    SELECT array_agg(t.x ORDER BY t.ord) INTO v_hashes
      FROM jsonb_array_elements_text(v_row.content_fingerprint->'hashes') WITH ORDINALITY AS t(x, ord);
    v_n := COALESCE(cardinality(v_hashes), 0);
    IF v_key ~ '^[0-9a-f]{64}$' AND v_dur > 0 AND v_n BETWEEN 1 AND 8 THEN
      FOR i IN 1..v_n LOOP
        IF v_hashes[i] !~ '^[0-9a-f]{16}$' THEN v_bits := NULL; EXIT; END IF;
        v_bits[i] := ('x' || v_hashes[i])::bit(64);
      END LOOP;
      IF v_bits IS NOT NULL THEN
        INSERT INTO video_sync_hints (fingerprint_key, fingerprint_version, duration_ms, frame_hashes, source_game_id,
                                      tipoff_video_time, method, confidence, detected_by)
        VALUES (v_key, 1, v_dur, v_bits, v_source, v_seconds, 'confirmed', NULL, p_user)
        ON CONFLICT (fingerprint_key, detected_by) DO UPDATE
          SET duration_ms       = EXCLUDED.duration_ms,
              frame_hashes      = EXCLUDED.frame_hashes,
              source_game_id    = COALESCE(EXCLUDED.source_game_id, video_sync_hints.source_game_id),
              tipoff_video_time = EXCLUDED.tipoff_video_time,
              method            = 'confirmed',
              confidence        = NULL,
              hidden_at         = NULL,
              updated_at        = now();
      END IF;
    END IF;
  END IF;

  UPDATE game_videos SET sync_status = p_status WHERE id = p_video_id;
  RETURN jsonb_build_object('sync_status', p_status, 'seconds', v_seconds);
END;
$$;
REVOKE ALL ON FUNCTION _game_video_set_sync(uuid, uuid, text, double precision) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-quarter syncs
-- ---------------------------------------------------------------------------
-- The shape checks, as the function's parseSyncPeriodsPayload makes them:
-- global periods "2" … "8" for a quarter's own sync (Q1 is the top-level
-- sync), "1" … "8" for a mark; video times from 0 up to ten hours; real-world
-- times as ISO 8601 with a zone; anchors of a known kind with a short label.
-- Each helper returns the entry with only the fields it checked, or raises
-- invalid_request.

-- An ISO 8601 time with a zone ("2026-09-20T17:30:00Z", "…T17:30:00.000+00:00").
CREATE OR REPLACE FUNCTION _sync_time_ok(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN RETURN false; END IF;
  IF (p_value #>> '{}') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' THEN
    RETURN false;
  END IF;
  PERFORM (p_value #>> '{}')::timestamptz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;   -- "2026-02-30T…": the right shape, not a day
END;
$$;
REVOKE ALL ON FUNCTION _sync_time_ok(jsonb) FROM PUBLIC, anon, authenticated;

-- An anchor: {kind, label} (a quarter's sync), with realWorldTime when `p_timed` (a mark's).
CREATE OR REPLACE FUNCTION _sync_anchor_entry(p_value jsonb, p_timed boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR jsonb_typeof(p_value->'kind') IS DISTINCT FROM 'string'
     OR (p_value->>'kind') NOT IN ('first_basket', 'match_start', 'period_start', 'play')
     OR jsonb_typeof(p_value->'label') IS DISTINCT FROM 'string'
     OR length(p_value->>'label') > 200
     OR (p_timed AND NOT _sync_time_ok(p_value->'realWorldTime')) THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  RETURN jsonb_build_object('kind', p_value->'kind', 'label', p_value->'label')
         || CASE WHEN p_timed THEN jsonb_build_object('realWorldTime', p_value->'realWorldTime') ELSE '{}'::jsonb END;
END;
$$;
REVOKE ALL ON FUNCTION _sync_anchor_entry(jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- One quarter's own sync: {syncVideoTime, syncRealWorldTime, anchor?}.
CREATE OR REPLACE FUNCTION _sync_period_entry(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seconds double precision;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR jsonb_typeof(p_value->'syncVideoTime') IS DISTINCT FROM 'number'
     OR NOT _sync_time_ok(p_value->'syncRealWorldTime') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  v_seconds := (p_value->>'syncVideoTime')::double precision;
  IF v_seconds < 0 OR v_seconds >= 36000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  RETURN jsonb_build_object('syncVideoTime', p_value->'syncVideoTime', 'syncRealWorldTime', p_value->'syncRealWorldTime')
         || CASE WHEN p_value ? 'anchor' AND jsonb_typeof(p_value->'anchor') <> 'null'
                 THEN jsonb_build_object('anchor', _sync_anchor_entry(p_value->'anchor', false))
                 ELSE '{}'::jsonb END;
END;
$$;
REVOKE ALL ON FUNCTION _sync_period_entry(jsonb) FROM PUBLIC, anon, authenticated;

-- One period's league mark: {anchor, startRealWorldTime?, endRealWorldTime?}.
CREATE OR REPLACE FUNCTION _sync_mark_entry(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_field text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  v_out := jsonb_build_object('anchor', _sync_anchor_entry(p_value->'anchor', true));
  FOREACH v_field IN ARRAY ARRAY['startRealWorldTime', 'endRealWorldTime'] LOOP
    IF p_value ? v_field AND jsonb_typeof(p_value->v_field) <> 'null' THEN
      IF NOT _sync_time_ok(p_value->v_field) THEN RAISE EXCEPTION 'invalid_request'; END IF;
      v_out := v_out || jsonb_build_object(v_field, p_value->v_field);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION _sync_mark_entry(jsonb) FROM PUBLIC, anon, authenticated;

-- Called by the function's sync_periods_set for the row's uploader.
--   p_sync.periods        every quarter's own sync after the change; absent,
--                         null or {} = none (the whole game follows Q1)
--   p_sync.marks          the league's marks; absent = kept, null = dropped
--   p_sync.breaksCut      true | false; absent = kept, null = dropped
--   p_sync.syncVideoTime  the tip-off, set as the uploader's manual sync
--                         (rule 1) in the same transaction; absent = kept
-- The game must have a sync (no_sync): a quarter's own sync refines it.
-- Returns {sync_point, sync_status}: the game's sync point as written and
-- the row's status.
CREATE OR REPLACE FUNCTION _game_video_set_periods(
  p_video_id uuid,
  p_user     uuid,
  p_sync     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     game_videos%ROWTYPE;
  v_sync    jsonb;
  v_next    jsonb;
  v_periods jsonb := '{}'::jsonb;
  v_marks   jsonb := '{}'::jsonb;
  v_key     text;
  v_value   jsonb;
  v_status  text;
BEGIN
  SELECT * INTO v_row FROM game_videos WHERE id = p_video_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.uploaded_by IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'ready' THEN RAISE EXCEPTION 'wrong_status'; END IF;
  IF p_sync IS NULL OR jsonb_typeof(p_sync) <> 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;

  -- Everything is checked before anything is written.
  IF p_sync ? 'periods' AND jsonb_typeof(p_sync->'periods') <> 'null' THEN
    IF jsonb_typeof(p_sync->'periods') <> 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_sync->'periods') LOOP
      IF v_key !~ '^[2-8]$' THEN RAISE EXCEPTION 'invalid_request'; END IF;
      v_periods := v_periods || jsonb_build_object(v_key, _sync_period_entry(v_value));
    END LOOP;
  END IF;
  IF p_sync ? 'marks' AND jsonb_typeof(p_sync->'marks') <> 'null' THEN
    IF jsonb_typeof(p_sync->'marks') <> 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_sync->'marks') LOOP
      IF v_key !~ '^[1-8]$' THEN RAISE EXCEPTION 'invalid_request'; END IF;
      v_marks := v_marks || jsonb_build_object(v_key, _sync_mark_entry(v_value));
    END LOOP;
  END IF;
  IF p_sync ? 'breaksCut' AND jsonb_typeof(p_sync->'breaksCut') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF p_sync ? 'syncVideoTime' AND jsonb_typeof(p_sync->'syncVideoTime') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  -- The tip-off first, by the uploader's manual rule (its own checks and hint).
  IF jsonb_typeof(p_sync->'syncVideoTime') = 'number' THEN
    PERFORM _game_video_set_sync(p_video_id, p_user, 'manual', (p_sync->>'syncVideoTime')::double precision);
  END IF;

  SELECT sync_point INTO v_sync FROM matches WHERE id = v_row.match_id FOR UPDATE;
  IF v_sync IS NULL OR jsonb_typeof(v_sync->'syncVideoTime') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'no_sync'; END IF;

  v_next := (v_sync - 'periods')
            || CASE WHEN v_periods = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('periods', v_periods) END;
  IF p_sync ? 'marks' THEN
    v_next := (v_next - 'marks')
              || CASE WHEN v_marks = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('marks', v_marks) END;
  END IF;
  IF p_sync ? 'breaksCut' THEN
    v_next := (v_next - 'breaksCut')
              || CASE WHEN jsonb_typeof(p_sync->'breaksCut') = 'boolean' THEN jsonb_build_object('breaksCut', p_sync->'breaksCut') ELSE '{}'::jsonb END;
  END IF;

  UPDATE matches SET sync_point = v_next WHERE id = v_row.match_id;
  SELECT sync_status INTO v_status FROM game_videos WHERE id = p_video_id;
  RETURN jsonb_build_object('sync_point', v_next, 'sync_status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION _game_video_set_periods(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Superseded clip files: the queue
-- ---------------------------------------------------------------------------
-- A shipped clip's key, as presign-upload's CLIP_KEY and game-video-wire.ts's
-- CLIP_SHIP_KEY_RE admit it (keys without the _s segment come from older
-- desktop builds): clips/<matchId>/<eventId>_pre<P>_post<Q>[_s<S>].mp4.
CREATE TABLE media_deletions (
  storage_key text PRIMARY KEY
    CHECK (storage_key ~ '^clips/[A-Za-z0-9-]{1,64}/[0-9]{1,12}_pre-?[0-9]{1,4}\.[0-9]_post-?[0-9]{1,4}\.[0-9](_s[0-9]{1,6}\.[0-9])?\.mp4$'),
  queued_at   timestamptz NOT NULL DEFAULT now(),
  -- replaced: the clip points at another file now; cleared: at none (a trim, a sync change).
  reason      text NOT NULL CHECK (reason IN ('replaced', 'cleared'))
);
CREATE INDEX media_deletions_queued_idx ON media_deletions (queued_at);

-- No policies and no client privileges: the function drains it with the service role.
ALTER TABLE media_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON media_deletions FROM anon, authenticated;

-- The clip key a public URL serves, read from the end of its path
-- ("https://pub-….r2.dev/clips/<m>/<e>_pre10.0_post3.0_s12.5.mp4" →
-- "clips/<m>/…"); null for anything that isn't a shipped clip's URL (a
-- highlight, a query string, another scheme). The base itself is the
-- function's R2_PUBLIC_URL, which the database doesn't know; the purge only
-- ever deletes a key nothing references, whatever URL queued it.
CREATE OR REPLACE FUNCTION _media_clip_key(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT substring(p_url FROM '^https?://[^/?#]+(?:/[^?#]*)?/(clips/[A-Za-z0-9-]{1,64}/[0-9]{1,12}_pre-?[0-9]{1,4}\.[0-9]_post-?[0-9]{1,4}\.[0-9](?:_s[0-9]{1,6}\.[0-9])?\.mp4)$');
$$;
REVOKE ALL ON FUNCTION _media_clip_key(text) FROM PUBLIC, anon, authenticated;

-- Queues a clip key for the purge; anything that isn't a clip key is ignored.
-- True when the key is (now or already) queued.
CREATE OR REPLACE FUNCTION _queue_media_deletion(p_key text, p_reason text DEFAULT 'replaced')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL
     OR p_key !~ '^clips/[A-Za-z0-9-]{1,64}/[0-9]{1,12}_pre-?[0-9]{1,4}\.[0-9]_post-?[0-9]{1,4}\.[0-9](_s[0-9]{1,6}\.[0-9])?\.mp4$' THEN
    RETURN false;
  END IF;
  INSERT INTO media_deletions (storage_key, reason)
  VALUES (p_key, CASE WHEN p_reason = 'cleared' THEN 'cleared' ELSE 'replaced' END)
  ON CONFLICT (storage_key) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION _queue_media_deletion(text, text) FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER on purpose, like queue_game_video_deletion: a coach's
-- clearShippedClip runs as the user over PostgREST, and the user has no right
-- to write the queue. Housekeeping never fails the clip's update.
CREATE OR REPLACE FUNCTION queue_superseded_clip_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
BEGIN
  v_old := _media_clip_key(OLD.r2_url);
  IF v_old IS NOT NULL AND v_old IS DISTINCT FROM _media_clip_key(NEW.r2_url) THEN
    PERFORM _queue_media_deletion(v_old, CASE WHEN NEW.r2_url IS NULL THEN 'cleared' ELSE 'replaced' END);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[game-video] queue_superseded_clip_file failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION queue_superseded_clip_file() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_queue_superseded_clip_file
  AFTER UPDATE OF r2_url ON playlist_clips
  FOR EACH ROW
  WHEN (OLD.r2_url IS NOT NULL AND OLD.r2_url IS DISTINCT FROM NEW.r2_url)
  EXECUTE FUNCTION queue_superseded_clip_file();

-- ---------------------------------------------------------------------------
-- 4. The purge's view of the queue
-- ---------------------------------------------------------------------------
-- The oldest queued keys under a prefix (the function's MEDIA_PURGE_SCOPE:
-- 'clips/' for every clip, 'clips/smoke-' for the smoke's throwaway games).
CREATE OR REPLACE FUNCTION _media_deletions_due(p_limit integer, p_key_prefix text)
RETURNS TABLE (storage_key text, queued_at timestamptz, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.storage_key, d.queued_at, d.reason
    FROM media_deletions d
   WHERE starts_with(d.storage_key, COALESCE(p_key_prefix, 'clips/'))
   ORDER BY d.queued_at, d.storage_key
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;
REVOKE ALL ON FUNCTION _media_deletions_due(integer, text) FROM PUBLIC, anon, authenticated;

-- Is a clip file still in use? Any playlist clip whose URL ends in the key
-- (another playlist with the same clip and clip length shares the file), or
-- a live ship job about to write it (its plan, written at render_take).
CREATE OR REPLACE FUNCTION _media_key_referenced(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM playlist_clips c
            WHERE c.r2_url IS NOT NULL
              AND right(c.r2_url, length(p_key) + 1) = '/' || p_key)
      OR EXISTS (
           SELECT 1 FROM render_jobs j
            WHERE j.kind = 'ship'
              AND j.status IN ('queued', 'running')
              AND jsonb_typeof(j.params->'clips') = 'array'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(j.params->'clips') e WHERE e->>'key' = p_key));
$$;
REVOKE ALL ON FUNCTION _media_key_referenced(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The nightly purge drains both queues
-- ---------------------------------------------------------------------------
-- Re-created from 20261019100000: `purge` (the private bucket's
-- game_video_deletions) and `media_purge` (the public bucket's
-- media_deletions), each only when its queue holds anything. The cron job
-- (purge-game-videos, 04:00 UTC) stays as it is.
CREATE OR REPLACE FUNCTION run_game_video_purge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fn_url text;
  v_secret text;
BEGIN
  SELECT value INTO v_fn_url FROM app_config WHERE key = 'notify_email_fn_url';
  IF v_fn_url IS NULL OR v_fn_url = '' THEN RETURN; END IF;   -- not configured yet

  SELECT value INTO v_secret FROM app_config WHERE key = 'game_video_purge_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM game_video_deletions) THEN
    PERFORM net.http_post(
      url     := v_fn_url || '/game-video',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
      body    := jsonb_build_object('action', 'purge')
    );
  END IF;
  IF EXISTS (SELECT 1 FROM media_deletions) THEN
    PERFORM net.http_post(
      url     := v_fn_url || '/game-video',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
      body    := jsonb_build_object('action', 'media_purge')
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Housekeeping; never let it raise into whatever called it.
  RAISE WARNING '[game-video] run_game_video_purge failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION run_game_video_purge() FROM PUBLIC, anon, authenticated;
