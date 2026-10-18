-- Cloud game videos, milestone 2: browser uploads and the converter.
--
-- The desktop encodes a game's 720p copy on the user's computer and uploads
-- it. A browser can't encode, so it uploads the ORIGINAL to a source key and
-- our converter (a container the `game-video` function starts) downloads it,
-- makes the copy, finds the tip-off and reports back. The row carries the
-- whole story: status gains `converting`; the source upload, the conversion
-- bookkeeping (attempt, heartbeat, progress, error), the sync anchor the web
-- knew at import, the copy's content fingerprint, the detector's result and
-- the sync status are columns. Every converter write is fenced by the attempt
-- number, so a container from an old attempt can never win.
--
-- Setup after `db push`, per project (never in a migration):
--   INSERT INTO app_config (key, value) VALUES ('game_video_worker_secret', '<same as the function's GAME_VIDEO_WORKER_SECRET>');
-- The `game_video_ready` email template must be deployed in send-email first.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE game_videos
  ADD COLUMN origin text NOT NULL DEFAULT 'desktop' CHECK (origin IN ('desktop', 'browser')),
  -- The original a browser uploaded: <prefix>/sources/<matchId>/<videoId>.<ext>, kept
  -- until the conversion succeeds, or for a week after it failed (retry_convert).
  ADD COLUMN source_storage_key text UNIQUE,
  ADD COLUMN source_upload_id text,
  ADD COLUMN source_part_size integer,
  ADD COLUMN source_size_bytes bigint,
  ADD COLUMN source_name text,
  -- What the sync anchors on and when it happened, from the play-by-play at import.
  ADD COLUMN anchor_kind text CHECK (anchor_kind IN ('tipoff', 'first_basket', 'match_start')),
  ADD COLUMN anchor_label text,
  ADD COLUMN anchor_real_world_time timestamptz,
  -- The conversion: NULL progress = waiting for a converter.
  ADD COLUMN convert_progress real CHECK (convert_progress IS NULL OR (convert_progress >= 0 AND convert_progress <= 1)),
  ADD COLUMN convert_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN convert_heartbeat_at timestamptz,
  ADD COLUMN convert_error text,
  -- The copy's content fingerprint ({version, durationMs, offsetsS, hashes, key}), for the confirmed hint.
  ADD COLUMN content_fingerprint jsonb,
  ADD COLUMN fps real,
  -- NULL on desktop rows. See GameVideoSyncStatus in packages/shared/lib/game-video-wire.ts.
  ADD COLUMN sync_status text CHECK (sync_status IN ('pending', 'applied', 'suggested', 'not_found', 'skipped', 'confirmed', 'manual')),
  ADD COLUMN suggested_tipoff_seconds double precision,
  ADD COLUMN suggested_confidence real CHECK (suggested_confidence IS NULL OR (suggested_confidence >= 0 AND suggested_confidence <= 1));

ALTER TABLE game_videos DROP CONSTRAINT game_videos_status_check;
ALTER TABLE game_videos ADD CONSTRAINT game_videos_status_check
  CHECK (status IN ('uploading', 'converting', 'ready', 'failed'));

CREATE INDEX game_videos_converting_idx ON game_videos (convert_heartbeat_at) WHERE status = 'converting';

-- ---------------------------------------------------------------------------
-- 2. The allowance counts conversions in flight; mark_ready accepts them
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _game_video_allowance(p_user uuid, p_org uuid)
RETURNS TABLE (tier text, max_games integer, used integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text;
  v_raw  text;
  v_max  int := 0;
BEGIN
  SELECT o.plan_tier INTO v_tier FROM organizations o WHERE o.id = p_org;
  v_tier := COALESCE(v_tier, 'free');

  SELECT value INTO v_raw FROM app_config WHERE key = 'game_video_limits';
  BEGIN
    v_max := COALESCE((v_raw::jsonb ->> v_tier)::int, 0);
  EXCEPTION WHEN OTHERS THEN
    v_max := 0;   -- a mistyped row means "nothing allowed", never an error
  END;

  RETURN QUERY SELECT
    v_tier,
    v_max,
    -- Uploads and conversions older than a week never finish: R2 aborts the
    -- upload after 7 days and the sweep fails the row.
    (SELECT COUNT(*)::int FROM game_videos gv
      WHERE gv.uploaded_by = p_user
        AND (p_org IS NULL OR gv.org_id = p_org)
        AND (gv.status = 'ready'
             OR (gv.status IN ('uploading', 'converting') AND gv.created_at > now() - interval '7 days')));
END;
$$;
REVOKE ALL ON FUNCTION _game_video_allowance(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _game_video_mark_ready(p_video_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match  text;
  v_status text;
BEGIN
  SELECT match_id, status INTO v_match, v_status FROM game_videos WHERE id = p_video_id FOR UPDATE;
  IF v_match IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_status = 'ready' THEN RETURN; END IF;
  IF v_status NOT IN ('uploading', 'converting') THEN RAISE EXCEPTION 'wrong_status'; END IF;

  DELETE FROM game_videos WHERE match_id = v_match AND status = 'ready' AND id <> p_video_id;
  UPDATE game_videos
     SET status = 'ready', ready_at = now(), upload_id = NULL
   WHERE id = p_video_id;
END;
$$;
REVOKE ALL ON FUNCTION _game_video_mark_ready(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deletions queue the original too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION queue_game_video_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The copy: an open multipart upload (the desktop's, or the converter's) is aborted instead.
  INSERT INTO game_video_deletions (storage_key, upload_id)
  VALUES (OLD.storage_key, CASE WHEN OLD.status IN ('uploading', 'converting') THEN OLD.upload_id END)
  ON CONFLICT (storage_key) DO NOTHING;
  -- The original, while it is still there.
  IF OLD.source_storage_key IS NOT NULL THEN
    INSERT INTO game_video_deletions (storage_key, upload_id)
    VALUES (OLD.source_storage_key, CASE WHEN OLD.status = 'uploading' THEN OLD.source_upload_id END)
    ON CONFLICT (storage_key) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The converter finished: metadata, the sync, ready
-- ---------------------------------------------------------------------------
-- Called by the function's job_done. Outcomes: 'confirmed' (a confirmed hint
-- matched the recording), 'estimate' (the detector's result, with its
-- confidence), 'not_found', 'skipped' (no detection for this game). A
-- confirmed hint or a confident estimate is applied to the game when the
-- game has no sync yet; the coach's own sync always stays. Returns the sync
-- status it wrote. Idempotent for a row that is ready already.
-- The apply rule is mirrored by syncStatusFor() in packages/shared/lib/game-video-convert.ts.
CREATE OR REPLACE FUNCTION _game_video_finish_convert(
  p_video_id   uuid,
  p_attempt    integer,
  p_size_bytes bigint,
  p_duration   double precision,
  p_width      integer,
  p_height     integer,
  p_fps        real,
  p_fingerprint jsonb,
  p_outcome    text,
  p_tipoff     double precision,
  p_confidence real
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    game_videos%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_row FROM game_videos WHERE id = p_video_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status = 'ready' THEN RETURN COALESCE(v_row.sync_status, 'skipped'); END IF;
  IF v_row.status <> 'converting' THEN RAISE EXCEPTION 'wrong_status'; END IF;
  IF v_row.convert_attempts <> p_attempt THEN RAISE EXCEPTION 'stale_attempt'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed', 'estimate', 'not_found', 'skipped') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  v_status := CASE p_outcome
    WHEN 'confirmed' THEN 'applied'
    WHEN 'estimate'  THEN CASE WHEN p_confidence IS NOT NULL AND p_confidence >= 0.75 THEN 'applied' ELSE 'suggested' END
    ELSE p_outcome
  END;

  IF v_status = 'applied' THEN
    IF p_tipoff IS NULL OR v_row.anchor_real_world_time IS NULL OR COALESCE(v_row.anchor_kind, 'tipoff') <> 'tipoff' THEN
      v_status := 'suggested';   -- nothing to anchor the time on
    ELSE
      UPDATE matches
         SET sync_point = COALESCE(sync_point, '{}'::jsonb) || jsonb_build_object(
               'syncVideoTime',     p_tipoff,
               'syncRealWorldTime', to_char(v_row.anchor_real_world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       WHERE id = v_row.match_id
         AND (sync_point IS NULL OR sync_point->>'syncVideoTime' IS NULL);
      IF NOT FOUND THEN v_status := 'suggested'; END IF;   -- the coach synced it already: theirs wins
    END IF;
  END IF;

  UPDATE game_videos
     SET size_bytes               = p_size_bytes,
         duration_seconds         = p_duration,
         width                    = p_width,
         height                   = p_height,
         fps                      = p_fps,
         content_fingerprint      = p_fingerprint,
         sync_status              = v_status,
         suggested_tipoff_seconds = CASE WHEN p_outcome IN ('confirmed', 'estimate') THEN p_tipoff END,
         suggested_confidence     = CASE WHEN p_outcome = 'confirmed' THEN 1 WHEN p_outcome = 'estimate' THEN p_confidence END,
         convert_progress         = 1,
         convert_heartbeat_at     = now(),
         convert_error            = NULL
   WHERE id = p_video_id;

  PERFORM _game_video_mark_ready(p_video_id);
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION _game_video_finish_convert(uuid, integer, bigint, double precision, integer, integer, real, jsonb, text, double precision, real)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The uploader confirms or sets the sync on the web
-- ---------------------------------------------------------------------------
-- Called by the function's sync_set for the row's uploader. Writes the game's
-- sync point (merging into what is there, so quarter marks survive), a
-- confirmed hint for this recording (tip-off anchors with a fingerprint), and
-- the row's sync status. A sync the coach set themselves is never changed
-- here ('sync_locked'): only one the converter applied, or none, can be.
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
  IF v_seconds IS NULL OR v_seconds <= -3600 OR v_seconds >= 36000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF v_row.anchor_real_world_time IS NULL THEN RAISE EXCEPTION 'no_anchor'; END IF;

  SELECT sync_point, source_game_id INTO v_sync, v_source FROM matches WHERE id = v_row.match_id FOR UPDATE;
  IF v_sync IS NOT NULL AND v_sync->>'syncVideoTime' IS NOT NULL
     AND COALESCE(v_row.sync_status, '') NOT IN ('applied', 'confirmed', 'manual') THEN
    RAISE EXCEPTION 'sync_locked';
  END IF;

  v_anchor := CASE WHEN COALESCE(v_row.anchor_kind, 'tipoff') <> 'tipoff'
                   THEN jsonb_build_object('kind', v_row.anchor_kind, 'label', COALESCE(v_row.anchor_label, v_row.anchor_kind))
              END;
  UPDATE matches
     SET sync_point = COALESCE(sync_point, '{}'::jsonb)
                      || jsonb_build_object(
                           'syncVideoTime',     v_seconds,
                           'syncRealWorldTime', to_char(v_row.anchor_real_world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                      || CASE WHEN v_anchor IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('anchor', v_anchor) END
   WHERE id = v_row.match_id;

  -- The confirmed hint: the same shape upsert_video_sync_hint writes, keyed on (fingerprint_key, detected_by).
  IF COALESCE(v_row.anchor_kind, 'tipoff') = 'tipoff' AND v_row.content_fingerprint IS NOT NULL THEN
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
-- 6. The sweep: every ten minutes, the function tidies conversions
-- ---------------------------------------------------------------------------
-- Starts rows waiting for a converter, re-runs rows whose converter died,
-- gives up after three attempts, and expires week-old originals. Only when
-- there is anything to look at.
CREATE OR REPLACE FUNCTION run_game_video_sweep()
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
  IF v_fn_url IS NULL OR v_fn_url = '' THEN RETURN; END IF;

  SELECT value INTO v_secret FROM app_config WHERE key = 'game_video_worker_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM game_videos
     WHERE status = 'converting'
        OR (origin = 'browser' AND source_storage_key IS NOT NULL AND status IN ('failed', 'uploading'))
  ) THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_fn_url || '/game-video',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-worker-secret', v_secret
    ),
    body    := jsonb_build_object('action', 'sweep')
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[game-video] run_game_video_sweep failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION run_game_video_sweep() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sweep-game-videos';
    PERFORM cron.schedule('sweep-game-videos', '*/10 * * * *', 'SELECT run_game_video_sweep()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule sweep-game-videos manually';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. "Your game is ready to watch"
-- ---------------------------------------------------------------------------
-- A browser upload takes a while to convert, so the uploader may have left.
-- The template builds the game's URL from match_id (send-email's APP_URL).
CREATE OR REPLACE FUNCTION notify_game_video_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_title text;
BEGIN
  v_email := _get_user_email(NEW.uploaded_by);
  IF v_email IS NULL THEN RETURN NEW; END IF;
  SELECT title INTO v_title FROM matches WHERE id = NEW.match_id;
  PERFORM _send_notification_email(v_email, 'game_video_ready', jsonb_build_object(
    'game_title',  COALESCE(v_title, 'Your game'),
    'match_id',    NEW.match_id,
    'sync_status', COALESCE(NEW.sync_status, 'skipped')
  ));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[game-video] notify_game_video_ready failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_game_video_ready
  AFTER UPDATE OF status ON game_videos
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'ready' AND NEW.origin = 'browser')
  EXECUTE FUNCTION notify_game_video_ready();
