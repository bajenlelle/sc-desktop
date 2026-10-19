-- Cloud game videos, milestone 3a: render jobs (server-cut clips).
--
-- A playlist built on the web has clips without files; the people it is
-- shared with can only watch files (playlist_clips.r2_url in the public media
-- bucket, as the desktop's Clip & Ship makes them). The `game-video` function
-- now cuts those files on the server from the owner's cloud copies, and a
-- `render_jobs` row carries each run with the conversions' bookkeeping:
-- status, attempt (every converter write is fenced by it), heartbeat,
-- progress, `requeue` for an edit made while the job ran, and the result.
-- `kind` is 'ship' now and 'export' in the next milestone, which is also what
-- `request` (the export's aspect) is for. Rows are written by the function
-- only (service role); the owner reads their own, and nobody writes from a
-- client. A job's notification to pending shares runs here, without the
-- auth gate the desktop's RPC has, through `_notify_pending_shares_for_playlist`.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE render_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('ship', 'export')),
  playlist_id  uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id       uuid REFERENCES organizations(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  -- Set on a running job when the playlist changed meanwhile: a fresh job follows this one.
  requeue      boolean NOT NULL DEFAULT false,
  attempt      integer NOT NULL DEFAULT 0,
  -- NULL while the job waits for a renderer; the sweep re-runs a running job whose heartbeat went quiet.
  heartbeat_at timestamptz,
  progress     real CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
  -- What was asked for ({} for a ship; {"aspect": "16:9" | "9:16"} for an export).
  request      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The plan the renderer took (clips, windows, keys), written at render_take.
  params       jsonb,
  -- On done: {shipped, failed, superseded, total, failures: [{matchId, eventId, error}]}.
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

-- One live job per playlist, kind and aspect: a second request coalesces into it.
CREATE UNIQUE INDEX render_jobs_live_idx
  ON render_jobs (playlist_id, kind, (COALESCE(request->>'aspect', '')))
  WHERE status IN ('queued', 'running');
-- The sweep's view: live jobs by heartbeat.
CREATE INDEX render_jobs_heartbeat_idx ON render_jobs (heartbeat_at) WHERE status IN ('queued', 'running');
CREATE INDEX render_jobs_user_idx ON render_jobs (user_id, created_at DESC);
-- The web follows a playlist's latest job of a kind.
CREATE INDEX render_jobs_playlist_idx ON render_jobs (playlist_id, kind, created_at DESC);

CREATE TRIGGER render_jobs_updated_at
  BEFORE UPDATE ON render_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE render_jobs ENABLE ROW LEVEL SECURITY;

-- The owner follows their own jobs. No write policies: the function writes.
CREATE POLICY render_jobs_read ON render_jobs
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Notifying pending shares once files exist, from the server
-- ---------------------------------------------------------------------------
-- The body of notify_pending_playlist_shares (20260831100000) without its
-- auth gate: the function calls it with the service role when a render job
-- has landed the playlist's files. Idempotent: rows notify exactly once, and
-- nothing is delivered while the playlist still has no shipped clip.
CREATE OR REPLACE FUNCTION _notify_pending_shares_for_playlist(p_playlist_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share record;
BEGIN
  IF NOT _playlist_has_shipped_clips(p_playlist_id) THEN
    RETURN;
  END IF;

  FOR v_share IN
    SELECT id, user_id, shared_by FROM playlist_user_shares
      WHERE playlist_id = p_playlist_id AND notified_at IS NULL
  LOOP
    PERFORM _notify_user_share(p_playlist_id, v_share.user_id, v_share.shared_by);
    UPDATE playlist_user_shares SET notified_at = now() WHERE id = v_share.id;
  END LOOP;

  FOR v_share IN
    SELECT id, team_id FROM playlist_shares
      WHERE playlist_id = p_playlist_id AND notified_at IS NULL
  LOOP
    PERFORM _notify_team_share(p_playlist_id, v_share.team_id);
    UPDATE playlist_shares SET notified_at = now() WHERE id = v_share.id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION _notify_pending_shares_for_playlist(uuid) FROM PUBLIC, anon, authenticated;

-- The desktop's RPC keeps its checks and defers to the internal one.
CREATE OR REPLACE FUNCTION notify_pending_playlist_shares(p_playlist_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM playlists WHERE id = p_playlist_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  PERFORM _notify_pending_shares_for_playlist(p_playlist_id);
END;
$$;
GRANT EXECUTE ON FUNCTION notify_pending_playlist_shares(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Is anyone watching? (a sync change re-cuts shared playlists' clips only)
-- ---------------------------------------------------------------------------
-- True when the playlist reaches anyone besides its owner: a team share, a
-- direct share, or the legacy playlists.team_id channel.
CREATE OR REPLACE FUNCTION _playlist_is_shared(p_playlist_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM playlist_shares WHERE playlist_id = p_playlist_id)
      OR EXISTS (SELECT 1 FROM playlist_user_shares WHERE playlist_id = p_playlist_id)
      OR EXISTS (SELECT 1 FROM playlists WHERE id = p_playlist_id AND team_id IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION _playlist_is_shared(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Retention: finished jobs are history after a week
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _render_jobs_retention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM render_jobs
   WHERE status IN ('done', 'failed')
     AND COALESCE(finished_at, updated_at) < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION _render_jobs_retention() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The sweep also minds render jobs
-- ---------------------------------------------------------------------------
-- Re-created whole from 20261019200000: the retention runs first, and the
-- function's sweep is called when a conversion OR a render job is live.
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
  PERFORM _render_jobs_retention();

  SELECT value INTO v_fn_url FROM app_config WHERE key = 'notify_email_fn_url';
  IF v_fn_url IS NULL OR v_fn_url = '' THEN RETURN; END IF;

  SELECT value INTO v_secret FROM app_config WHERE key = 'game_video_worker_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM game_videos
     WHERE status = 'converting'
        OR (origin = 'browser' AND source_storage_key IS NOT NULL AND status IN ('failed', 'uploading'))
  ) AND NOT EXISTS (
    SELECT 1 FROM render_jobs WHERE status IN ('queued', 'running')
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
