-- Nightly tip-off job (scripts/nightly-tipoff, .github/workflows/nightly-tipoff.yml):
-- one row per BasketTV game the job has looked at, so a run can skip what is done
-- and retry failures a few times. Written only by the bot user, through the RPCs
-- below; the bot is identified by its email in app_config ('tipoff_bot_email').
-- The hints themselves go through upsert_video_sync_hint like any user's.

CREATE TABLE baskettv_tipoff_runs (
  game_slug         text PRIMARY KEY,
  channel           text NOT NULL,
  league            text,
  media_id          text,
  game_start_at     timestamptz,
  home_team         text,
  away_team         text,
  status            text NOT NULL CHECK (status IN ('found', 'starts_after_tipoff', 'not_found', 'failed')),
  tipoff_video_time double precision,
  basis             text,
  confidence        real,
  hint_id           uuid,
  api_calls         integer,
  frames            integer,
  bytes_read        bigint,
  error             text,
  attempts          integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX baskettv_tipoff_runs_updated_at_idx ON baskettv_tipoff_runs (updated_at DESC);
-- RPC-only: RLS on, no policies (the service role bypasses).
ALTER TABLE baskettv_tipoff_runs ENABLE ROW LEVEL SECURITY;

INSERT INTO app_config (key, value) VALUES ('tipoff_bot_email', 'tipoff-bot@scoutable.se')
ON CONFLICT (key) DO NOTHING;

-- The signed-in user is the batch bot (email claim == app_config.tipoff_bot_email).
CREATE OR REPLACE FUNCTION is_tipoff_bot()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND lower(coalesce(auth.jwt() ->> 'email', '')) = lower((SELECT value FROM app_config WHERE key = 'tipoff_bot_email'))
$$;
REVOKE ALL ON FUNCTION is_tipoff_bot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_tipoff_bot() TO authenticated;

-- Outcome of one game; a later call for the same game replaces it and counts another attempt.
CREATE OR REPLACE FUNCTION record_baskettv_tipoff_run(
  p_game_slug text,
  p_channel text,
  p_league text,
  p_media_id text,
  p_game_start_at timestamptz,
  p_home_team text,
  p_away_team text,
  p_status text,
  p_tipoff_video_time double precision DEFAULT NULL,
  p_basis text DEFAULT NULL,
  p_confidence real DEFAULT NULL,
  p_hint_id uuid DEFAULT NULL,
  p_api_calls integer DEFAULT NULL,
  p_frames integer DEFAULT NULL,
  p_bytes_read bigint DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_tipoff_bot() THEN RAISE EXCEPTION 'not_batch_user'; END IF;
  IF p_game_slug IS NULL OR p_game_slug !~ '^[a-z0-9]{4,32}$' THEN RAISE EXCEPTION 'invalid_game'; END IF;
  IF p_channel IS NULL OR p_channel !~ '^[a-z0-9-]{2,64}$' THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('found', 'starts_after_tipoff', 'not_found', 'failed') THEN RAISE EXCEPTION 'invalid_status'; END IF;

  INSERT INTO baskettv_tipoff_runs AS r (
    game_slug, channel, league, media_id, game_start_at, home_team, away_team, status,
    tipoff_video_time, basis, confidence, hint_id, api_calls, frames, bytes_read, error
  ) VALUES (
    p_game_slug, p_channel, left(p_league, 120), left(p_media_id, 64), p_game_start_at, left(p_home_team, 120), left(p_away_team, 120), p_status,
    p_tipoff_video_time, left(p_basis, 120), p_confidence, p_hint_id, p_api_calls, p_frames, p_bytes_read, left(p_error, 500)
  )
  ON CONFLICT (game_slug) DO UPDATE SET
    channel = EXCLUDED.channel, league = EXCLUDED.league, media_id = EXCLUDED.media_id,
    game_start_at = EXCLUDED.game_start_at, home_team = EXCLUDED.home_team, away_team = EXCLUDED.away_team,
    status = EXCLUDED.status, tipoff_video_time = EXCLUDED.tipoff_video_time, basis = EXCLUDED.basis,
    confidence = EXCLUDED.confidence, hint_id = EXCLUDED.hint_id, api_calls = EXCLUDED.api_calls,
    frames = EXCLUDED.frames, bytes_read = EXCLUDED.bytes_read, error = EXCLUDED.error,
    attempts = r.attempts + 1, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION record_baskettv_tipoff_run(text, text, text, text, timestamptz, text, text, text, double precision, text, real, uuid, integer, integer, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_baskettv_tipoff_run(text, text, text, text, timestamptz, text, text, text, double precision, text, real, uuid, integer, integer, bigint, text) TO authenticated;

-- What the job already knows about these games.
CREATE OR REPLACE FUNCTION list_baskettv_tipoff_runs(p_slugs text[])
RETURNS TABLE (game_slug text, status text, attempts integer, tipoff_video_time double precision, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_tipoff_bot() THEN RAISE EXCEPTION 'not_batch_user'; END IF;
  IF p_slugs IS NULL OR cardinality(p_slugs) > 2000 THEN RAISE EXCEPTION 'invalid_game'; END IF;
  RETURN QUERY
    SELECT r.game_slug, r.status, r.attempts, r.tipoff_video_time, r.updated_at
    FROM baskettv_tipoff_runs r
    WHERE r.game_slug = ANY (p_slugs);
END;
$$;
REVOKE ALL ON FUNCTION list_baskettv_tipoff_runs(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_baskettv_tipoff_runs(text[]) TO authenticated;
