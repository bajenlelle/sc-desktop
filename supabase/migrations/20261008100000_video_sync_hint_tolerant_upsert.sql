-- Re-fingerprinting the same recording on another machine shifts a few hash bits
-- (ffmpeg builds decode slightly differently), which changes the fingerprint key.
-- The upsert then inserted a second hint next to the caller's earlier one instead
-- of replacing it (nightly job re-run, 2026-10-07). Now the caller's own existing
-- hint for the same recording — matched with the lookup's tolerance — is updated
-- first; only a recording the caller has no hint for gets a new row.

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
  v_method text;
  v_key_taken boolean;
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

  -- The caller's own hint for this recording: the exact key first (hidden or not,
  -- as the unique constraint sees it), else a visible one within the lookup's
  -- tolerance — duration within 5 s and at least 75 % of the hashes within 10 bits
  -- (HINT_MATCH in packages/shared/lib/video-fingerprint.ts).
  SELECT h.id, h.method INTO v_id, v_method
  FROM video_sync_hints h
  WHERE h.detected_by = v_uid
    AND (
      h.fingerprint_key = p_fingerprint_key
      OR (
        h.hidden_at IS NULL
        AND h.fingerprint_version = 1
        AND cardinality(h.frame_hashes) = v_n
        AND abs(h.duration_ms - p_duration_ms) <= 5000
        AND (SELECT count(*) FROM generate_series(1, v_n) AS k
             WHERE bit_count(h.frame_hashes[k] # v_bits[k]) <= 10) * 4 >= v_n * 3
      )
    )
  ORDER BY (h.fingerprint_key = p_fingerprint_key) DESC, h.created_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- An automatic result never downgrades a confirmed hint.
    IF v_method = 'confirmed' AND p_method = 'auto' THEN RETURN v_id; END IF;
    -- Take the new key unless another row of the caller already holds it (UNIQUE (fingerprint_key, detected_by)).
    SELECT EXISTS (
      SELECT 1 FROM video_sync_hints x WHERE x.detected_by = v_uid AND x.fingerprint_key = p_fingerprint_key AND x.id <> v_id
    ) INTO v_key_taken;
    UPDATE video_sync_hints
    SET fingerprint_key   = CASE WHEN v_key_taken THEN fingerprint_key ELSE p_fingerprint_key END,
        duration_ms       = p_duration_ms,
        frame_hashes      = v_bits,
        source_game_id    = COALESCE(p_source_game_id, source_game_id),
        tipoff_video_time = p_tipoff_video_time,
        method            = p_method,
        confidence        = p_confidence,
        updated_at        = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- No hint of the caller's for this recording yet. The conflict clause only guards a race.
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

  IF v_id IS NULL THEN
    SELECT h.id INTO v_id FROM video_sync_hints h
    WHERE h.fingerprint_key = p_fingerprint_key AND h.detected_by = v_uid;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION upsert_video_sync_hint(text, integer, text[], text, double precision, text, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION upsert_video_sync_hint(text, integer, text[], text, double precision, text, real) TO authenticated;
