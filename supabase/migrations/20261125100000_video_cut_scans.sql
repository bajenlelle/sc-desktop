-- Hard cuts found in a game recording (ffmpeg's scene score over the whole file), shared by the
-- recording's fingerprint as the tip-off hints are (video_sync_hints): the desktop searches a
-- linked video in the background after an import, and the next coach who links the same
-- recording (a BasketTV replay everyone downloads) gets the result without searching.
-- A cut is a moment, in seconds into the recording, where the picture changes at once: a
-- dropped stream joined back on (play is lost there), or a production's own cut (graphics in a
-- break, a camera switch). Which of them are jumps inside the game depends on the game's sync
-- and is worked out in the app (packages/shared/lib/video-jumps.ts); the raw cuts are stored.
-- Only the fingerprint (duration and frame hashes) and the cut times leave the machine.

CREATE TABLE video_cut_scans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_key     text NOT NULL,                       -- sha256 hex of the canonical fingerprint; per-file idempotency only
  fingerprint_version smallint NOT NULL DEFAULT 1,
  duration_ms         integer NOT NULL CHECK (duration_ms > 0),
  frame_hashes        bit(64)[] NOT NULL,                  -- dHash per fingerprint offset that fit the recording
  cuts                double precision[] NOT NULL CHECK (cardinality(cuts) <= 2000),
  threshold           real NOT NULL CHECK (threshold > 0 AND threshold < 1),
  scanned_by          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  hidden_at           timestamptz,                         -- platform-admin moderation
  UNIQUE (fingerprint_key, scanned_by)
);

CREATE INDEX video_cut_scans_duration_ms_idx ON video_cut_scans (duration_ms) WHERE hidden_at IS NULL;

ALTER TABLE video_cut_scans ENABLE ROW LEVEL SECURITY;   -- no policies: RPC access only

-- Scans of this recording, closest fingerprint first, the caller's own ahead of others' at the
-- same distance. The app applies the exact match rule (HINT_MATCH in
-- packages/shared/lib/video-fingerprint.ts); the server only cuts the list down.
CREATE OR REPLACE FUNCTION find_video_cut_scans(
  p_duration_ms integer,
  p_hashes text[]
)
RETURNS TABLE (
  cuts double precision[],
  threshold real,
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
  IF v_n < 1 OR v_n > 8 OR p_duration_ms IS NULL OR p_duration_ms <= 0 THEN
    RAISE EXCEPTION 'invalid_fingerprint';
  END IF;
  FOR i IN 1..v_n LOOP
    IF p_hashes[i] !~ '^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'invalid_fingerprint'; END IF;
    v_bits[i] := ('x' || p_hashes[i])::bit(64);
  END LOOP;

  RETURN QUERY
  WITH dist AS (
    SELECT s.cuts, s.threshold, (s.scanned_by = v_uid) AS is_mine,
           ARRAY(SELECT bit_count(s.frame_hashes[k] # v_bits[k])
                 FROM generate_series(1, LEAST(cardinality(s.frame_hashes), v_n)) AS k)::integer[] AS distances,
           (s.duration_ms - p_duration_ms) AS duration_delta_ms,
           s.created_at
    FROM video_cut_scans s
    WHERE s.hidden_at IS NULL
      AND s.fingerprint_version = 1
      AND abs(s.duration_ms - p_duration_ms) <= 5000
  )
  SELECT d.cuts, d.threshold, d.is_mine, d.distances, d.duration_delta_ms, d.created_at
  FROM dist d
  WHERE (SELECT sum(x) FROM unnest(d.distances) AS x) <= 20 * cardinality(d.distances)
  ORDER BY (SELECT sum(x) FROM unnest(d.distances) AS x) ASC, d.is_mine DESC, d.created_at DESC
  LIMIT 5;
END;
$$;

REVOKE ALL ON FUNCTION find_video_cut_scans(integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION find_video_cut_scans(integer, text[]) TO authenticated;

-- The caller's scan of a recording, written once the whole file has been searched; a new scan of
-- the same file (same key) replaces the caller's earlier one.
CREATE OR REPLACE FUNCTION save_video_cut_scan(
  p_fingerprint_key text,
  p_duration_ms integer,
  p_hashes text[],
  p_cuts double precision[],
  p_threshold real
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
  IF p_threshold IS NULL OR p_threshold <= 0 OR p_threshold >= 1 THEN RAISE EXCEPTION 'invalid_threshold'; END IF;
  IF p_cuts IS NULL OR cardinality(p_cuts) > 2000
     OR EXISTS (SELECT 1 FROM unnest(p_cuts) AS c WHERE c IS NULL OR c < 0 OR c > p_duration_ms / 1000.0 + 5) THEN
    RAISE EXCEPTION 'invalid_cuts';
  END IF;
  FOR i IN 1..v_n LOOP
    IF p_hashes[i] !~ '^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'invalid_fingerprint'; END IF;
    v_bits[i] := ('x' || p_hashes[i])::bit(64);
  END LOOP;

  INSERT INTO video_cut_scans (fingerprint_key, fingerprint_version, duration_ms, frame_hashes, cuts, threshold, scanned_by)
  VALUES (p_fingerprint_key, 1, p_duration_ms, v_bits, p_cuts, p_threshold, v_uid)
  ON CONFLICT (fingerprint_key, scanned_by) DO UPDATE
    SET duration_ms  = EXCLUDED.duration_ms,
        frame_hashes = EXCLUDED.frame_hashes,
        cuts         = EXCLUDED.cuts,
        threshold    = EXCLUDED.threshold,
        updated_at   = now()
  RETURNING video_cut_scans.id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION save_video_cut_scan(text, integer, text[], double precision[], real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_video_cut_scan(text, integer, text[], double precision[], real) TO authenticated;
