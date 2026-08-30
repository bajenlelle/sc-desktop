-- =============================================================================
-- Device registry (anti-account-sharing v1: detect, don't gate).
--
-- Every app persists a client-generated device UUID and calls `touch_device`
-- on sign-in / app start. Rows are per (user, device) — unlike push_tokens,
-- which deliberately migrates a token to the last signer-in, this table
-- PRESERVES shared-device history so one account used from many devices is
-- visible over time.
--
-- V1 ships no enforcement: `list_device_outliers` gives platform admins the
-- accounts whose 30-day active device count exceeds the app_config caps
-- (device_cap_player / device_cap_coach). A future gate raises
-- device_limit_reached from touch_device behind an app_config flag once the
-- caps are validated against real data.
--
-- Privacy: no IPs, no fingerprints — only a user-visible device label, shown
-- back to the account owner on their profile page.
-- =============================================================================

CREATE TABLE user_devices (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL,          -- client-generated, persisted per install/browser
  app         text NOT NULL CHECK (app IN ('web', 'desktop', 'mobile')),
  platform    text,                   -- 'macOS', 'iOS 18.5', 'Windows'…
  device_name text,                   -- 'Chrome on Windows', 'Leonards iPhone'
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX idx_user_devices_user_seen ON user_devices (user_id, last_seen DESC);
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Owners may list their own devices (profile page); writes go through the
-- definer RPC only.
CREATE POLICY ud_self_read ON user_devices
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Registration. Called on sign-in and app start; idempotent per device.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_device(
  p_device_id uuid,
  p_app text,
  p_platform text DEFAULT NULL,
  p_device_name text DEFAULT NULL
)
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
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'invalid_device';
  END IF;
  IF p_app NOT IN ('web', 'desktop', 'mobile') THEN
    RAISE EXCEPTION 'invalid_app';
  END IF;

  INSERT INTO user_devices (user_id, device_id, app, platform, device_name)
    VALUES (v_uid, p_device_id, p_app, p_platform, p_device_name)
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET app = EXCLUDED.app,
          platform = COALESCE(EXCLUDED.platform, user_devices.platform),
          device_name = COALESCE(EXCLUDED.device_name, user_devices.device_name),
          last_seen = now();
END;
$$;

GRANT EXECUTE ON FUNCTION touch_device(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Platform-admin instrument: accounts whose active (30-day) device count
-- exceeds their role's cap. Feeds /admin/devices and, later, gate thresholds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_device_outliers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap_player int;
  v_cap_coach int;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  SELECT COALESCE((SELECT value::int FROM app_config WHERE key = 'device_cap_player'), 3)
    INTO v_cap_player;
  SELECT COALESCE((SELECT value::int FROM app_config WHERE key = 'device_cap_coach'), 4)
    INTO v_cap_coach;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY (row_data->>'active_devices')::int DESC)
    FROM (
      SELECT jsonb_build_object(
        'user_id', p.id,
        'full_name', p.full_name,
        'email', _get_user_email(p.id),
        'role', p.role,
        'orgs', (
          SELECT COALESCE(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb)
          FROM org_memberships om
          JOIN organizations o ON o.id = om.org_id
          WHERE om.user_id = p.id AND NOT o.is_personal
        ),
        'cap', CASE WHEN p.role = 'player' THEN v_cap_player ELSE v_cap_coach END,
        'active_devices', d.active_count,
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
          AND ud.last_seen > now() - interval '30 days'
      ) d ON true
      WHERE d.active_count >
        CASE WHEN p.role = 'player' THEN v_cap_player ELSE v_cap_coach END
    ) rows
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION list_device_outliers() TO authenticated;

-- ---------------------------------------------------------------------------
-- Push hygiene for "Sign out all other devices": revoking refresh tokens does
-- NOT unregister push, so an evicted device would keep receiving the
-- account's notifications. Deletes the caller's tokens except the one the
-- calling device holds (mobile passes its own; web/desktop pass NULL = all).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_other_push_tokens(p_keep_token text DEFAULT NULL)
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
  DELETE FROM push_tokens
    WHERE user_id = v_uid
      AND (p_keep_token IS NULL OR token <> p_keep_token);
END;
$$;

GRANT EXECUTE ON FUNCTION prune_other_push_tokens(text) TO authenticated;

-- Default caps (config-tunable without a migration).
INSERT INTO app_config (key, value) VALUES
  ('device_cap_player', '3'),
  ('device_cap_coach', '4')
ON CONFLICT (key) DO NOTHING;
