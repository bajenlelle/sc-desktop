-- ============================================================================
-- touch_device: guard against a stale-but-unexpired access token surviving
-- account deletion.
--
-- auth.uid() only checks the JWT's signature/expiry, not whether the user
-- row still exists — deleteUser() revokes refresh tokens but not an
-- already-issued short-lived access token cached in another tab/session.
-- That race let a delete-account request race a background touch_device
-- call from a second tab, which passed the v_uid IS NULL check and then hit
-- user_devices_user_id_fkey as an unhandled Postgres error (Sentry noise;
-- touchDevice already swallows any RPC `error`, so nothing user-visible
-- broke). Returning a non-ok/blocked status instead of raising keeps this
-- out of `error` entirely — parseTouchVerdict already treats any unknown
-- status as a no-op (packages/shared/lib/devices-db.ts), so no client
-- change is needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION touch_device(
  p_device_id          uuid DEFAULT NULL,
  p_app                text DEFAULT NULL,
  p_platform           text DEFAULT NULL,
  p_device_name        text DEFAULT NULL,
  p_hardware_id        text DEFAULT NULL,
  p_replaces_device_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := (SELECT auth.uid());
  v_device_id  uuid;
  v_hex        text;
  v_first_seen timestamptz := now();
  v_replaced   timestamptz;
  v_registered boolean := false;
  v_gate_on    boolean;
  v_days       integer;
  v_cap        integer;
  v_active     integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  -- A still-unexpired access token for a since-deleted user passes the
  -- check above; bail out as a no-op rather than hitting the FK below.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;
  -- p_app defaults to NULL now, so the v1 `NOT IN` check alone would let
  -- NULL slip through (NULL NOT IN (...) is NULL, not true).
  IF p_app IS NULL OR p_app NOT IN ('web', 'desktop', 'mobile') THEN
    RAISE EXCEPTION 'invalid_app';
  END IF;

  -- Canonical identity: hardware-derived beats the client uuid. Per-user
  -- salt, then stamp version nibble '5' + RFC variant '8' — a valid-shaped
  -- uuid whose version marks it as hardware-derived (legacy ids are v4).
  IF p_hardware_id IS NOT NULL AND length(trim(p_hardware_id)) > 0 THEN
    v_hex := encode(substring(sha256((v_uid::text || ':' || lower(trim(p_hardware_id)))::bytea) FROM 1 FOR 16), 'hex');
    v_hex := overlay(v_hex PLACING '5' FROM 13 FOR 1);
    v_hex := overlay(v_hex PLACING '8' FROM 17 FOR 1);
    v_device_id := v_hex::uuid;
  ELSIF p_device_id IS NOT NULL THEN
    v_device_id := p_device_id;
  ELSE
    RAISE EXCEPTION 'invalid_device';
  END IF;

  -- Legacy-row collapse: fold the pre-hardware random-uuid row into this
  -- one. Scoped to v_uid (can never delete another user's row); a missing
  -- row is a silent no-op (clients resend until the migration is confirmed,
  -- so repeat boots land here); a 1:1 swap inherits the old row's slot, so
  -- a migrating device can never be blocked by the gate below.
  IF p_replaces_device_id IS NOT NULL AND p_replaces_device_id <> v_device_id THEN
    DELETE FROM user_devices
      WHERE user_id = v_uid AND device_id = p_replaces_device_id
      RETURNING first_seen INTO v_replaced;
    IF v_replaced IS NOT NULL THEN
      v_registered := true;
      v_first_seen := v_replaced;
    END IF;
  END IF;

  v_registered := v_registered OR EXISTS (
    SELECT 1 FROM user_devices WHERE user_id = v_uid AND device_id = v_device_id);

  -- Race guard: two brand-new devices booting concurrently must not both
  -- slip under the cap. Per-user advisory lock, then re-check — the
  -- claim-guard analog for a condition (count < cap) that no unique
  -- constraint can express.
  IF NOT v_registered THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('user_devices:' || v_uid::text, 0));
    v_registered := EXISTS (
      SELECT 1 FROM user_devices WHERE user_id = v_uid AND device_id = v_device_id);
  END IF;

  v_days := COALESCE((SELECT value::int FROM app_config WHERE key = 'device_active_days'), 30);
  v_cap  := _device_cap_for(v_uid);
  SELECT count(*) INTO v_active
    FROM user_devices
    WHERE user_id = v_uid
      AND device_id <> v_device_id
      AND last_seen > now() - (v_days || ' days')::interval;

  -- Already-registered rows (even stale ones) are always ok + touched:
  -- the cap only ever bites brand-new registrations.
  IF NOT v_registered AND v_active >= v_cap THEN
    v_gate_on := COALESCE(
      (SELECT value::boolean FROM app_config WHERE key = 'device_gate_enabled'), false);
    -- Recorded whether or not the gate is on — enforced=false rows are the
    -- dark-launch data that validates the caps before the flag flips.
    INSERT INTO device_gate_events (user_id, device_id, app, enforced)
      VALUES (v_uid, v_device_id, p_app, v_gate_on)
      ON CONFLICT DO NOTHING;
    IF v_gate_on THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'device_id', v_device_id,
        'active_count', v_active,
        'cap', v_cap);
    END IF;
  END IF;

  INSERT INTO user_devices (user_id, device_id, app, platform, device_name, first_seen)
    VALUES (v_uid, v_device_id, p_app, p_platform, p_device_name, v_first_seen)
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET app         = EXCLUDED.app,
          platform    = COALESCE(EXCLUDED.platform, user_devices.platform),
          device_name = COALESCE(EXCLUDED.device_name, user_devices.device_name),
          first_seen  = LEAST(user_devices.first_seen, EXCLUDED.first_seen),
          last_seen   = now();

  RETURN jsonb_build_object(
    'status', 'ok',
    'device_id', v_device_id,
    'active_count', v_active + 1,
    'cap', v_cap);
END;
$$;

GRANT EXECUTE ON FUNCTION touch_device(uuid, text, text, text, text, uuid) TO authenticated;
