-- =============================================================================
-- Device registry v2: hardware identity + dark-launched hard-cap gate.
--
-- V1 rows were client-generated random UUIDs persisted in browser/webview
-- storage — per BROWSER, not per device (two browsers = two rows, a storage
-- wipe = a new row). V2 upgrades identity where the platform allows it:
--   desktop  sends a Rust-side sha256 of the machine id ("dt:<hex>"),
--   mobile   sends iOS identifierForVendor / Android SSAID ("ios:.."/"and:.."),
--   web      keeps its per-browser UUID (browsers expose no hardware identity;
--            fingerprinting stays off the table).
-- The server canonicalizes hardware ids to a per-user-salted uuid, so raw
-- hardware identifiers are NEVER stored, and a stored device_id can't be
-- correlated across accounts or rainbow-looked-up from a known SSAID.
-- Canonical ids are stamped as UUID version 5 (legacy random ids are v4), so
-- hardware-identity adoption is measurable from the version nibble alone.
--
-- The gate ships DARK: over-cap registrations are recorded in
-- device_gate_events either way, but blocked verdicts are only returned when
-- app_config device_gate_enabled = 'true'. Blocked is a returned verdict, not
-- a RAISE — every shipped client swallows touch errors by design ("registry
-- plumbing must never break sign-in"), so an exception would be invisible.
--
-- Eviction semantics: per-device session revocation does not exist in GoTrue.
-- remove_device deletes the registry row; the evicted device's NEXT boot
-- touch_device returns blocked while the cap is full — that is the actual
-- eviction mechanism. Removing your own current device is allowed (the RPC
-- can't know the caller's device); it simply re-registers or blocks on the
-- next boot, and the UI hides Remove on the current row.
--
-- Privacy: unchanged stance — no IPs, no fingerprints, hardware ids hashed
-- with a per-user salt before storage.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. device_gate_events: dark-launch telemetry (modeled on seat_limit_hits).
--    One row per (user, device, day) of over-cap registration attempts —
--    enforced=false rows are the data that validates flipping the flag.
--    Server-written only: RLS on, zero policies.
-- ---------------------------------------------------------------------------
CREATE TABLE device_gate_events (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id  uuid NOT NULL,
  app        text NOT NULL,
  enforced   boolean NOT NULL,
  blocked_on date NOT NULL DEFAULT current_date,
  PRIMARY KEY (user_id, device_id, blocked_on)
);
ALTER TABLE device_gate_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Role/cap helpers. V1 capped on legacy profiles.role (NOT NULL DEFAULT
--    'coach', barely maintained) — a direct-signup player silently got the
--    coach cap. These mirror packages/shared/lib/orgs.ts isPlayerOnly():
--    at least one club org AND every club-org role is 'player'; zero club
--    orgs => coach cap (same as the nav treats those users).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _is_player_only(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = p_user AND NOT o.is_personal
  ) AND NOT EXISTS (
    SELECT 1 FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = p_user AND NOT o.is_personal AND om.role <> 'player'
  );
$$;

CREATE OR REPLACE FUNCTION _device_cap_for(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN _is_player_only(p_user)
    THEN COALESCE((SELECT value::int FROM app_config WHERE key = 'device_cap_player'), 3)
    ELSE COALESCE((SELECT value::int FROM app_config WHERE key = 'device_cap_coach'), 4)
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. touch_device v2. Return type changes void -> jsonb, which requires
--    DROP + CREATE. Exactly ONE function must exist afterward (two overloads
--    break PostgREST resolution); old shipped clients keep calling with the
--    four original named args — the new params default to NULL — and discard
--    the jsonb (supabase-js callers only read `error`).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS touch_device(uuid, text, text, text);

CREATE FUNCTION touch_device(
  p_device_id          uuid DEFAULT NULL,  -- web / legacy clients
  p_app                text DEFAULT NULL,
  p_platform           text DEFAULT NULL,
  p_device_name        text DEFAULT NULL,
  p_hardware_id        text DEFAULT NULL,  -- "dt:<sha256hex>" | "ios:<idfv>" | "and:<ssaid>"; never stored raw
  p_replaces_device_id uuid DEFAULT NULL   -- pre-hardware random-uuid row to collapse into this one
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

-- ---------------------------------------------------------------------------
-- 4. remove_device: self-service eviction (profile page + the gate screen's
--    remedy). Deletes the caller's own row only. See header for why this IS
--    the eviction mechanism despite sessions surviving.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_device(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'invalid_device';
  END IF;

  DELETE FROM user_devices WHERE user_id = v_uid AND device_id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_device(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. list_device_outliers: same shape as v1 plus three fixes — membership-
--    derived role/cap (replaces legacy profiles.role), the active window from
--    app_config, and a blocked_30d gate-pressure count (new json key; the
--    existing TS mapper ignores unknown keys).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_device_outliers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  v_days := COALESCE((SELECT value::int FROM app_config WHERE key = 'device_active_days'), 30);

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY (row_data->>'active_devices')::int DESC)
    FROM (
      SELECT jsonb_build_object(
        'user_id', p.id,
        'full_name', p.full_name,
        'email', _get_user_email(p.id),
        'role', CASE WHEN _is_player_only(p.id) THEN 'player' ELSE 'coach' END,
        'orgs', (
          SELECT COALESCE(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb)
          FROM org_memberships om
          JOIN organizations o ON o.id = om.org_id
          WHERE om.user_id = p.id AND NOT o.is_personal
        ),
        'cap', _device_cap_for(p.id),
        'active_devices', d.active_count,
        'blocked_30d', (
          SELECT count(*) FROM device_gate_events e
          WHERE e.user_id = p.id AND e.blocked_on > current_date - 30
        ),
        'devices', d.devices
      ) AS row_data
      FROM profiles p
      JOIN LATERAL (
        SELECT count(*) AS active_count,
               jsonb_agg(jsonb_build_object(
                 'app', ud.app,
                 'platform', ud.platform,
                 'device_name', ud.device_name,
                 'first_seen', ud.first_seen,
                 'last_seen', ud.last_seen
               ) ORDER BY ud.last_seen DESC) AS devices
        FROM user_devices ud
        WHERE ud.user_id = p.id
          AND ud.last_seen > now() - (v_days || ' days')::interval
      ) d ON true
      WHERE d.active_count > _device_cap_for(p.id)
    ) rows
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION list_device_outliers() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Stale-row hygiene. V1 rows were immortal; the profile list grew forever.
--    Retention must stay well above device_active_days so a device can sit
--    out a whole season and still revive its (grandfathered) row.
--    Deleting rows only ever TIGHTENS the gate: a purged device that returns
--    must re-pass it, strictly harder than the grandfather path it lost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_stale_devices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := COALESCE(
    (SELECT value::int FROM app_config WHERE key = 'device_retention_days'), 180);
BEGIN
  DELETE FROM user_devices
    WHERE last_seen < now() - (v_days || ' days')::interval;
  DELETE FROM device_gate_events WHERE blocked_on < current_date - 90;
END;
$$;
-- No GRANT: cron/service-role only.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-stale-devices';
    PERFORM cron.schedule('purge-stale-devices', '30 4 * * *',
      'SELECT purge_stale_devices()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule purge-stale-devices manually';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Config (tunable without a migration). device_gate_enabled is THE
--    dark-launch flag: flip to 'true' only after hardware-identity adoption
--    is high (canonical ids are uuid v5 — substring(device_id::text,15,1)
--    splits hardware ('5') from legacy ('4') rows).
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value) VALUES
  ('device_gate_enabled', 'false'),
  ('device_active_days', '30'),
  ('device_retention_days', '180')
ON CONFLICT (key) DO NOTHING;
