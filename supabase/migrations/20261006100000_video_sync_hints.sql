-- Video sync hints: the tip-off offset of a game recording, shared across users.
--
-- A recording is identified by a content fingerprint (duration + a 64-bit
-- dHash of the frame at fixed offsets, see packages/shared/lib/video-fingerprint.ts),
-- so every rendition of the same stream matches. One row per (user, recording):
-- `auto` rows come from the detector, `confirmed` rows from a user who set or
-- accepted the offset; an automatic result never overwrites a confirmed one.
-- Both tables are RPC-only (RLS on, no policies): reads go through
-- find_video_sync_hints, writes through upsert_video_sync_hint, moderation
-- through hide_video_sync_hint. The edge function `tipoff-detect` logs each
-- model call in video_sync_detect_runs (service role) for the per-user rate
-- limit and cost telemetry. Kill switch: app_config.tipoff_detect_enabled.
--
-- Setup after `db push`:
--   npx supabase secrets set ANTHROPIC_API_KEY=<value> TIPOFF_DETECT_MODEL=<model id>
--   npx supabase functions deploy tipoff-detect
--   (document both secrets in docs/maintenance.md "Secrets map")

CREATE TABLE video_sync_hints (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_key     text NOT NULL,                       -- sha256 hex of the canonical fingerprint; per-file idempotency only
  fingerprint_version smallint NOT NULL DEFAULT 1,
  duration_ms         integer NOT NULL CHECK (duration_ms > 0),
  frame_hashes        bit(64)[] NOT NULL,                  -- dHash per fingerprint offset that fit the recording
  source_game_id      text,                                -- the game this recording was imported as, when known
  anchor              text NOT NULL DEFAULT 'q1_tipoff' CHECK (anchor IN ('q1_tipoff')),
  tipoff_video_time   double precision NOT NULL CHECK (tipoff_video_time > -3600 AND tipoff_video_time < 36000),
  method              text NOT NULL CHECK (method IN ('auto', 'confirmed')),
  confidence          real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  detected_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  hidden_at           timestamptz,                         -- platform-admin moderation
  UNIQUE (fingerprint_key, detected_by)
);

CREATE INDEX video_sync_hints_duration_ms_idx ON video_sync_hints (duration_ms) WHERE hidden_at IS NULL;

ALTER TABLE video_sync_hints ENABLE ROW LEVEL SECURITY;   -- no policies: RPC access only

CREATE TABLE video_sync_detect_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action        text NOT NULL,                             -- read_frames | locate_overlay
  frame_count   integer NOT NULL,
  model         text NOT NULL,
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  outcome       text NOT NULL,                             -- ok | model_refused | model_truncated | parse_failed | api_error
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX video_sync_detect_runs_user_id_created_at_idx ON video_sync_detect_runs (user_id, created_at DESC);

ALTER TABLE video_sync_detect_runs ENABLE ROW LEVEL SECURITY;   -- server-written only

INSERT INTO app_config (key, value) VALUES ('tipoff_detect_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Candidate hints for a fingerprint. Prefilters by duration and total distance;
-- the client applies the match rule (packages/shared/lib/video-fingerprint.ts).
CREATE OR REPLACE FUNCTION find_video_sync_hints(
  p_duration_ms integer,
  p_hashes text[],
  p_source_game_id text DEFAULT NULL,
  p_duration_tolerance_ms integer DEFAULT 5000
)
RETURNS TABLE (
  id uuid,
  tipoff_video_time double precision,
  method text,
  confidence real,
  source_game_id text,
  is_mine boolean,
  distances integer[],
  duration_delta_ms integer,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int := COALESCE(cardinality(p_hashes), 0);
  v_bits bit(64)[] := '{}';
  i int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_n < 1 OR v_n > 8 OR p_duration_ms IS NULL OR p_duration_ms <= 0
     OR p_duration_tolerance_ms IS NULL OR p_duration_tolerance_ms < 0 OR p_duration_tolerance_ms > 60000 THEN
    RAISE EXCEPTION 'invalid_fingerprint';
  END IF;
  FOR i IN 1..v_n LOOP
    IF p_hashes[i] !~ '^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'invalid_fingerprint'; END IF;
    v_bits[i] := ('x' || p_hashes[i])::bit(64);
  END LOOP;

  RETURN QUERY
  WITH cand AS (
    SELECT h.id, h.tipoff_video_time, h.method, h.confidence, h.source_game_id, h.detected_by,
           h.duration_ms, h.created_at, h.frame_hashes,
           LEAST(cardinality(h.frame_hashes), v_n) AS n
    FROM video_sync_hints h
    WHERE h.hidden_at IS NULL
      AND h.fingerprint_version = 1
      AND abs(h.duration_ms - p_duration_ms) <= p_duration_tolerance_ms
  ), dist AS (
    SELECT c.id, c.tipoff_video_time, c.method, c.confidence, c.source_game_id,
           (c.detected_by = v_uid) AS is_mine,
           ARRAY(SELECT bit_count(c.frame_hashes[k] # v_bits[k]) FROM generate_series(1, c.n) AS k)::integer[] AS distances,
           (c.duration_ms - p_duration_ms) AS duration_delta_ms,
           c.created_at
    FROM cand c
  )
  SELECT d.id, d.tipoff_video_time, d.method, d.confidence, d.source_game_id, d.is_mine,
         d.distances, d.duration_delta_ms, d.created_at
  FROM dist d
  WHERE (SELECT sum(x) FROM unnest(d.distances) AS x) <= 20 * cardinality(d.distances)
  ORDER BY (SELECT sum(x) FROM unnest(d.distances) AS x) ASC,
           (d.method = 'confirmed') DESC,
           (p_source_game_id IS NOT NULL AND d.source_game_id = p_source_game_id) DESC,
           d.created_at DESC
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION find_video_sync_hints(integer, text[], text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION find_video_sync_hints(integer, text[], text, integer) TO authenticated;

-- Writes or upgrades the caller's own hint; an automatic result never downgrades a confirmed one.
CREATE OR REPLACE FUNCTION upsert_video_sync_hint(
  p_fingerprint_key text,
  p_duration_ms integer,
  p_hashes text[],
  p_source_game_id text,
  p_tipoff_video_time double precision,
  p_method text,
  p_confidence real DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int := COALESCE(cardinality(p_hashes), 0);
  v_bits bit(64)[] := '{}';
  v_id uuid;
  i int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_fingerprint_key IS NULL OR p_fingerprint_key !~ '^[0-9a-f]{64}$'
     OR v_n < 1 OR v_n > 8 OR p_duration_ms IS NULL OR p_duration_ms <= 0 THEN
    RAISE EXCEPTION 'invalid_fingerprint';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('auto', 'confirmed') THEN RAISE EXCEPTION 'invalid_method'; END IF;
  IF p_tipoff_video_time IS NULL OR p_tipoff_video_time <= -3600 OR p_tipoff_video_time >= 36000 THEN
    RAISE EXCEPTION 'invalid_tipoff_time';
  END IF;
  IF p_confidence IS NOT NULL AND (p_confidence < 0 OR p_confidence > 1) THEN RAISE EXCEPTION 'invalid_confidence'; END IF;
  FOR i IN 1..v_n LOOP
    IF p_hashes[i] !~ '^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'invalid_fingerprint'; END IF;
    v_bits[i] := ('x' || p_hashes[i])::bit(64);
  END LOOP;

  INSERT INTO video_sync_hints (fingerprint_key, fingerprint_version, duration_ms, frame_hashes, source_game_id,
                                tipoff_video_time, method, confidence, detected_by)
  VALUES (p_fingerprint_key, 1, p_duration_ms, v_bits, p_source_game_id,
          p_tipoff_video_time, p_method, p_confidence, v_uid)
  ON CONFLICT (fingerprint_key, detected_by) DO UPDATE
    SET duration_ms       = EXCLUDED.duration_ms,
        frame_hashes      = EXCLUDED.frame_hashes,
        source_game_id    = COALESCE(EXCLUDED.source_game_id, video_sync_hints.source_game_id),
        tipoff_video_time = EXCLUDED.tipoff_video_time,
        method            = EXCLUDED.method,
        confidence        = EXCLUDED.confidence,
        updated_at        = now()
    WHERE NOT (video_sync_hints.method = 'confirmed' AND EXCLUDED.method = 'auto')
  RETURNING video_sync_hints.id INTO v_id;

  -- The no-downgrade clause suppressed the update: return the existing row.
  IF v_id IS NULL THEN
    SELECT h.id INTO v_id FROM video_sync_hints h
    WHERE h.fingerprint_key = p_fingerprint_key AND h.detected_by = v_uid;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION upsert_video_sync_hint(text, integer, text[], text, double precision, text, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION upsert_video_sync_hint(text, integer, text[], text, double precision, text, real) TO authenticated;

-- Platform-admin moderation: hide (or unhide) a hint for everyone.
CREATE OR REPLACE FUNCTION hide_video_sync_hint(p_id uuid, p_hidden boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  UPDATE video_sync_hints SET hidden_at = CASE WHEN p_hidden THEN now() ELSE NULL END WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION hide_video_sync_hint(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hide_video_sync_hint(uuid, boolean) TO authenticated;
