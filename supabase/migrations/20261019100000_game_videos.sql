-- =============================================================================
-- 20261019100000: Cloud game videos, milestone 1
--
-- Leonard, 2026-10-19. A game's video has only ever been a file on the coach's
-- computer (matches.video_url is that local path), so only the desktop can
-- clip. From here the desktop can also keep a 720p copy of the whole file in
-- a PRIVATE R2 bucket, and the web plays the game from it.
--
-- Rows are server-written: only the `game-video` edge function (service role)
-- inserts and updates them, around the multipart upload it brokers with
-- presigned part URLs. Clients read their own rows. Who may watch is the
-- uploader only in this milestone; `visibility` is the hook for team sharing.
--
-- Limits live in app_config, so they change without a release:
--   cloud_video_enabled   'true' | 'false'. The kill switch: read by the insert
--                         trigger below and by the function (503 feature_disabled).
--   game_video_limits     JSON, games per uploader and space, per plan tier:
--                         {"free":2,"rookie":6,"pro":40,"franchise":120}
-- The cap is enforced by a BEFORE INSERT trigger with a per-uploader advisory
-- lock, so two uploads started at once can't both squeeze under it.
--
-- Deletion: deleting a row (by hand, or through a match or account cascade)
-- queues its storage key in game_video_deletions. The function's `purge`
-- action, called nightly by pg_cron through net.http_post (like the season
-- audit), removes the objects. Setup, both required or the job no-ops:
--   1. Function secret:  npx supabase secrets set GAME_VIDEO_PURGE_SECRET=<value>
--   2. Same value in SQL: INSERT INTO app_config (key, value)
--                         VALUES ('game_video_purge_secret', '<value>');
-- Verified by supabase/tests/game_videos.sh.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The copies
-- ---------------------------------------------------------------------------
CREATE TABLE game_videos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  uploaded_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             uuid REFERENCES organizations(id) ON DELETE SET NULL,   -- the match's space at upload, for the cap
  status             text NOT NULL CHECK (status IN ('uploading', 'ready', 'failed')),
  visibility         text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
  source_kind        text NOT NULL DEFAULT 'unknown' CHECK (source_kind IN ('unknown', 'broadcast', 'own')),
  storage_key        text NOT NULL UNIQUE,           -- <project ref>/games/<match id>/<id>.mp4
  upload_id          text,                           -- the multipart upload while status = 'uploading'
  part_size          integer CHECK (part_size IS NULL OR part_size > 0),
  size_bytes         bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  duration_seconds   double precision,
  width              integer,
  height             integer,
  source_fingerprint text,                           -- fingerprint_key of the local file the copy was made from
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  ready_at           timestamptz
);

-- One ready copy per game. A replacement is swapped in by _game_video_mark_ready.
CREATE UNIQUE INDEX game_videos_one_ready ON game_videos (match_id) WHERE status = 'ready';
CREATE INDEX game_videos_uploader_status_idx ON game_videos (uploaded_by, status);
CREATE INDEX game_videos_org_id_idx ON game_videos (org_id);

CREATE TRIGGER game_videos_updated_at
  BEFORE UPDATE ON game_videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE game_videos ENABLE ROW LEVEL SECURITY;

-- Uploaders read their own rows. No write policies: the function writes.
CREATE POLICY game_videos_read ON game_videos
  FOR SELECT USING (uploaded_by = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. The allowance, mirrored on _import_allowance
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
    -- Uploads older than a week never finish: R2 aborts them after 7 days.
    (SELECT COUNT(*)::int FROM game_videos gv
      WHERE gv.uploaded_by = p_user
        AND (p_org IS NULL OR gv.org_id = p_org)
        AND (gv.status = 'ready'
             OR (gv.status = 'uploading' AND gv.created_at > now() - interval '7 days')));
END;
$$;
REVOKE ALL ON FUNCTION _game_video_allowance(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION enforce_game_video_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled text;
  v_max     int;
  v_used    int;
BEGIN
  SELECT value INTO v_enabled FROM app_config WHERE key = 'cloud_video_enabled';
  IF v_enabled = 'false' THEN
    RAISE EXCEPTION 'feature_disabled';
  END IF;

  -- One insert per uploader at a time, so two uploads started together can't
  -- both read "one left".
  PERFORM pg_advisory_xact_lock(hashtext('game_videos:' || NEW.uploaded_by::text));

  SELECT a.max_games, a.used INTO v_max, v_used
    FROM _game_video_allowance(NEW.uploaded_by, NEW.org_id) a;

  -- Replacing a game's copy swaps one row for another: the old one stops
  -- counting once the new one is ready, so it must not block the new one.
  IF EXISTS (SELECT 1 FROM game_videos g WHERE g.match_id = NEW.match_id AND g.status = 'ready') THEN
    v_used := v_used - 1;
  END IF;

  IF v_used >= v_max THEN
    RAISE EXCEPTION 'game_video_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_game_video_cap
  BEFORE INSERT ON game_videos
  FOR EACH ROW EXECUTE FUNCTION enforce_game_video_cap();

-- Flips an upload to ready, replacing the game's older copy in the same
-- statement so the one-ready-per-game index never rejects it. A retried
-- complete finds the row ready already and does nothing.
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
  IF v_status <> 'uploading' THEN RAISE EXCEPTION 'wrong_status'; END IF;

  DELETE FROM game_videos WHERE match_id = v_match AND status = 'ready' AND id <> p_video_id;
  UPDATE game_videos
     SET status = 'ready', ready_at = now(), upload_id = NULL
   WHERE id = p_video_id;
END;
$$;
REVOKE ALL ON FUNCTION _game_video_mark_ready(uuid) FROM PUBLIC, anon, authenticated;

-- The meters in the apps. app_config is admin-only, so `enabled` comes through here.
CREATE OR REPLACE FUNCTION get_game_video_quota(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_enabled text;
  v_tier    text;
  v_max     int;
  v_used    int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT value INTO v_enabled FROM app_config WHERE key = 'cloud_video_enabled';
  SELECT a.tier, a.max_games, a.used INTO v_tier, v_max, v_used
    FROM _game_video_allowance(v_uid, p_org_id) a;

  RETURN jsonb_build_object(
    'enabled',   COALESCE(v_enabled, 'true') <> 'false',
    'tier',      v_tier,
    'max_games', v_max,
    'used',      v_used
  );
END;
$$;
REVOKE ALL ON FUNCTION get_game_video_quota(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_game_video_quota(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deletion queue
-- ---------------------------------------------------------------------------
CREATE TABLE game_video_deletions (
  storage_key text PRIMARY KEY,
  upload_id   text,                                  -- set for an unfinished upload: purge aborts it instead
  queued_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE game_video_deletions ENABLE ROW LEVEL SECURITY;   -- no policies: the function drains it

-- SECURITY DEFINER on purpose: a match or account delete runs as the user over
-- PostgREST and cascades into this trigger, and the user has no right to
-- write the queue.
CREATE OR REPLACE FUNCTION queue_game_video_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO game_video_deletions (storage_key, upload_id)
  VALUES (OLD.storage_key, CASE WHEN OLD.status = 'uploading' THEN OLD.upload_id END)
  ON CONFLICT (storage_key) DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_queue_game_video_deletion
  AFTER DELETE ON game_videos
  FOR EACH ROW EXECUTE FUNCTION queue_game_video_deletion();

-- ---------------------------------------------------------------------------
-- 4. Nightly purge
-- ---------------------------------------------------------------------------
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

  IF NOT EXISTS (SELECT 1 FROM game_video_deletions) THEN RETURN; END IF;   -- nothing queued

  PERFORM net.http_post(
    url     := v_fn_url || '/game-video',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-purge-secret', v_secret
    ),
    body    := jsonb_build_object('action', 'purge')
  );
EXCEPTION WHEN OTHERS THEN
  -- Housekeeping; never let it raise into whatever called it.
  RAISE WARNING '[game-video] run_game_video_purge failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION run_game_video_purge() FROM PUBLIC, anon, authenticated;

-- 04:00 UTC daily (idempotent; no-op where pg_cron isn't installed, e.g. local dev).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-game-videos';
    PERFORM cron.schedule('purge-game-videos', '0 4 * * *', 'SELECT run_game_video_purge()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule purge-game-videos manually';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Config defaults
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value) VALUES
  ('cloud_video_enabled', 'true'),
  ('game_video_limits',   '{"free":2,"rookie":6,"pro":40,"franchise":120}')
ON CONFLICT (key) DO NOTHING;
