-- =============================================================================
-- 20260902100000: Org license lifecycle overhaul
--
-- 1.  organizations: contact_name / contact_email / notes columns
-- 2.  org_license_events: audit trail for license/plan/contact changes
-- 3.  seat_limit_hits: dedup table for seat-cap notifications
-- 4.  org_license_state(): 'active' | 'expiring' | 'grace' | 'locked'
-- 5.  _get_org_admin_emails() (all admins, org_memberships-based) and
--     _get_org_admin_email() reimplemented over org_memberships (the old
--     version read deprecated profiles.org_id, which join_by_code stopped
--     writing in 20260505000004 — newer orgs resolved to NULL)
-- 6.  _get_platform_admin_emails()
-- 7.  notify_expiring_licenses() rewrite: thresholds 30/14/7/1 + at-expiry,
--     all admins + contact CC, no triple-send, no infinite retry
-- 8.  notify_platform_license_digest(): weekly platform-admin digest
-- 9.  request_license_renewal(): org admin asks Scoutable to renew
-- 10. update_org_license(): validation + audit + warning reset on renewal
-- 11. create_org_for_platform(): full setup in one call (plan/seats/expiry/contact)
-- 12. update_org_contact(), list_org_license_events()
-- 13. Expiry checks added to generate_org_invite / send_org_invite_emails
-- 14. Grace-lock enforcement: playlist_shares trigger, create_team_for_org,
--     assign_member_to_team raise 'license_locked' when past grace
-- 15. promote_to_admin(): coach seat check when promoting a player + email restored
-- 16. join_by_code / remove_member_from_org: notification emails restored
--     (user_joined_org / added_to_team / removed_from_org regressed during
--     the multi-org rewrites)
-- 17. get_all_orgs_with_counts(): license columns for the /admin list
-- 18. pg_cron schedules (daily expiry check, weekly digest) when available
--
-- Setup required after deployment (Supabase dashboard):
--   - Confirm pg_cron is enabled and both jobs exist (see section 18).
--   - Confirm app_config rows notify_email_fn_url / notify_email_secret /
--     app_url exist — _send_notification_email() no-ops silently without them.
--   - Redeploy the send-email Edge Function (new templates).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. organizations: contact + notes
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS contact_name  text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS notes         text;

-- ---------------------------------------------------------------------------
-- 2. org_license_events: audit trail (server-written; RLS on, no policies —
--    reads go through list_org_license_events below)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_license_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor      uuid,
  event      text NOT NULL CHECK (event IN (
               'org_created', 'license_updated', 'plan_tier_updated',
               'contact_updated', 'renewal_requested')),
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_license_events_org
  ON org_license_events (org_id, created_at DESC);

ALTER TABLE org_license_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. seat_limit_hits: one notification per org/role/day when joins bounce
--    off a seat cap (server-written; RLS on, no policies)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seat_limit_hits (
  org_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN ('coach', 'player')),
  hit_date date NOT NULL,
  PRIMARY KEY (org_id, role, hit_date)
);

ALTER TABLE seat_limit_hits ENABLE ROW LEVEL SECURITY;

INSERT INTO app_config (key, value) VALUES ('license_grace_days', '14')
  ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. org_license_state(): lifecycle state for one org.
--    Mirrored for display in packages/shared/lib/license-state.ts — keep the
--    thresholds (30-day expiring window, 14-day default grace) in sync.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_license_state(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz;
  v_grace_days integer;
BEGIN
  SELECT expires_at INTO v_expires_at FROM organizations WHERE id = p_org_id;
  IF v_expires_at IS NULL THEN
    RETURN 'active';
  END IF;

  SELECT COALESCE(value::integer, 14) INTO v_grace_days
    FROM app_config WHERE key = 'license_grace_days';
  v_grace_days := COALESCE(v_grace_days, 14);

  IF v_expires_at > now() + interval '30 days' THEN
    RETURN 'active';
  ELSIF v_expires_at > now() THEN
    RETURN 'expiring';
  ELSIF v_expires_at + (v_grace_days || ' days')::interval > now() THEN
    RETURN 'grace';
  ELSE
    RETURN 'locked';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION org_license_state(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Admin email helpers over org_memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _get_org_admin_emails(p_org_id uuid)
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT u.email::text
  FROM org_memberships om
  JOIN auth.users u ON u.id = om.user_id
  WHERE om.org_id = p_org_id AND om.role = 'admin'
  ORDER BY om.joined_at
$$;

-- Reimplement the single-admin helper over org_memberships (old version read
-- deprecated profiles.org_id and returned NULL for multi-org-era orgs).
CREATE OR REPLACE FUNCTION _get_org_admin_email(p_org_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT e FROM _get_org_admin_emails(p_org_id) e LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 6. Platform admin emails
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _get_platform_admin_emails()
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT u.email::text
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.is_platform_admin
$$;

-- ---------------------------------------------------------------------------
-- 7. notify_expiring_licenses() rewrite
--
-- Fixes over the 20260320000001 version:
--   - all org admins (org_memberships) + org contact_email, not one
--     profiles.org_id-based admin
--   - thresholds 30/14/7/1 days plus an at-expiry email (days_notice = 0)
--   - one email per run per org: the smallest matching threshold fires and
--     every larger threshold is marked sent (an org first seen at 5 days out
--     no longer gets 30d+7d+1d mails at once)
--   - orgs with no resolvable recipient still get their warning row
--     (no silent infinite retry)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_expiring_licenses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec         record;
  v_email       text;
  v_days        integer;
  v_days_left   integer;
  v_sent_any    boolean;
  v_app_url     text;
  v_manage_url  text;
  v_grace_days  integer;
  v_grace_until timestamptz;
  v_expires_on  text;
BEGIN
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_manage_url := COALESCE(v_app_url, 'https://app.scoutable.se') || '/organization';

  SELECT COALESCE(value::integer, 14) INTO v_grace_days
    FROM app_config WHERE key = 'license_grace_days';
  v_grace_days := COALESCE(v_grace_days, 14);

  -- Pre-expiry warnings: pick the smallest threshold that applies and hasn't
  -- been sent for this org, then mark it and every larger threshold as sent.
  FOR v_rec IN
    SELECT o.id, o.name, o.expires_at, o.contact_email
      FROM organizations o
      WHERE o.expires_at IS NOT NULL
        AND o.expires_at > now()
        AND o.expires_at <= now() + interval '30 days'
        AND NOT COALESCE(o.is_personal, false)
  LOOP
    SELECT MIN(t) INTO v_days
      FROM unnest(ARRAY[30, 14, 7, 1]) AS t
      WHERE v_rec.expires_at <= now() + (t || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM license_expiry_warnings w
          WHERE w.org_id = v_rec.id AND w.days_notice = t
        );

    CONTINUE WHEN v_days IS NULL;

    -- The email states the actual days remaining; v_days is only the
    -- threshold used for dedup (an org first seen at 20 days out crosses the
    -- 30-day threshold but should read "expires in 20 days").
    v_days_left := GREATEST(1, CEIL(EXTRACT(epoch FROM v_rec.expires_at - now()) / 86400)::integer);
    v_expires_on := to_char(v_rec.expires_at, 'FMMonth FMDD, YYYY');
    v_sent_any := false;

    FOR v_email IN
      SELECT DISTINCT e FROM (
        SELECT _get_org_admin_emails(v_rec.id) AS e
        UNION SELECT v_rec.contact_email
      ) emails WHERE e IS NOT NULL AND e != ''
    LOOP
      PERFORM _send_notification_email(
        v_email,
        'license_expiry',
        jsonb_build_object(
          'org_name',          v_rec.name,
          'days_until_expiry', v_days_left::text,
          'expires_on',        v_expires_on,
          'manage_url',        v_manage_url
        )
      );
      v_sent_any := true;
    END LOOP;

    IF NOT v_sent_any THEN
      RAISE WARNING '[license] org % has no admin or contact email for expiry warning', v_rec.id;
    END IF;

    -- Mark this threshold and all larger ones so the org gets exactly one
    -- email per crossed threshold going forward.
    INSERT INTO license_expiry_warnings (org_id, days_notice)
      SELECT v_rec.id, t FROM unnest(ARRAY[30, 14, 7, 1]) AS t WHERE t >= v_days
      ON CONFLICT DO NOTHING;
  END LOOP;

  -- At-expiry notice (days_notice = 0): sent once when the license lapses,
  -- framed around the grace window.
  FOR v_rec IN
    SELECT o.id, o.name, o.expires_at, o.contact_email
      FROM organizations o
      WHERE o.expires_at IS NOT NULL
        AND o.expires_at <= now()
        AND o.expires_at > now() - interval '7 days'
        AND NOT COALESCE(o.is_personal, false)
        AND NOT EXISTS (
          SELECT 1 FROM license_expiry_warnings w
          WHERE w.org_id = o.id AND w.days_notice = 0
        )
  LOOP
    v_grace_until := v_rec.expires_at + (v_grace_days || ' days')::interval;
    v_sent_any := false;

    FOR v_email IN
      SELECT DISTINCT e FROM (
        SELECT _get_org_admin_emails(v_rec.id) AS e
        UNION SELECT v_rec.contact_email
      ) emails WHERE e IS NOT NULL AND e != ''
    LOOP
      PERFORM _send_notification_email(
        v_email,
        'license_expired',
        jsonb_build_object(
          'org_name',    v_rec.name,
          'grace_until', to_char(v_grace_until, 'FMMonth FMDD, YYYY'),
          'manage_url',  v_manage_url
        )
      );
      v_sent_any := true;
    END LOOP;

    IF NOT v_sent_any THEN
      RAISE WARNING '[license] org % has no admin or contact email for expiry notice', v_rec.id;
    END IF;

    INSERT INTO license_expiry_warnings (org_id, days_notice)
      VALUES (v_rec.id, 0)
      ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. notify_platform_license_digest(): weekly overview for platform admins —
--    orgs expiring within 45 days or expired in the last 7. No-op when empty.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_platform_license_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orgs    jsonb;
  v_email   text;
  v_app_url text;
BEGIN
  SELECT jsonb_agg(row_data ORDER BY expires_at) INTO v_orgs
  FROM (
    SELECT
      o.expires_at,
      jsonb_build_object(
        'org_id',     o.id,
        'org_name',   o.name,
        'expires_on', to_char(o.expires_at, 'FMMonth FMDD, YYYY'),
        'status',     CASE WHEN o.expires_at <= now() THEN 'expired' ELSE 'expiring' END,
        'coaches',    (SELECT COUNT(*) FROM org_memberships om
                        WHERE om.org_id = o.id AND om.role IN ('coach', 'admin'))::text
                      || ' / ' || COALESCE(o.coach_seat_limit::text, '∞'),
        'players',    (SELECT COUNT(*) FROM org_memberships om
                        WHERE om.org_id = o.id AND om.role = 'player')::text
                      || ' / ' || COALESCE(o.player_seat_limit::text, '∞'),
        'contact',    COALESCE(o.contact_email, '—')
      ) AS row_data
    FROM organizations o
    WHERE o.expires_at IS NOT NULL
      AND NOT COALESCE(o.is_personal, false)
      AND o.expires_at <= now() + interval '45 days'
      AND o.expires_at > now() - interval '7 days'
  ) sub;

  IF v_orgs IS NULL THEN RETURN; END IF;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';

  FOR v_email IN SELECT * FROM _get_platform_admin_emails() LOOP
    PERFORM _send_notification_email(
      v_email,
      'license_digest',
      jsonb_build_object(
        'orgs',      v_orgs,
        'admin_url', COALESCE(v_app_url, 'https://app.scoutable.se') || '/admin'
      )
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. request_license_renewal(): org admin asks Scoutable to renew.
--    Rate-limited to one request per org per 7 days via the audit table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_license_renewal(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       organizations%ROWTYPE;
  v_requester text;
  v_req_email text;
  v_email     text;
  v_app_url   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = v_uid AND org_id = p_org_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM org_license_events
    WHERE org_id = p_org_id AND event = 'renewal_requested'
      AND created_at > now() - interval '7 days'
  ) THEN
    RAISE EXCEPTION 'renewal_already_requested';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;

  SELECT p.full_name INTO v_requester FROM profiles p WHERE p.id = v_uid;
  v_req_email := _get_user_email(v_uid);

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';

  INSERT INTO org_license_events (org_id, actor, event, new_values)
    VALUES (p_org_id, v_uid, 'renewal_requested',
            jsonb_build_object('requester', COALESCE(v_requester, v_req_email)));

  FOR v_email IN SELECT * FROM _get_platform_admin_emails() LOOP
    PERFORM _send_notification_email(
      v_email,
      'renewal_requested',
      jsonb_build_object(
        'org_name',        v_org.name,
        'requester_name',  COALESCE(v_requester, v_req_email, 'An org admin'),
        'requester_email', COALESCE(v_req_email, '—'),
        'coaches',         (SELECT COUNT(*) FROM org_memberships om
                             WHERE om.org_id = p_org_id AND om.role IN ('coach', 'admin'))::text
                           || ' / ' || COALESCE(v_org.coach_seat_limit::text, '∞'),
        'players',         (SELECT COUNT(*) FROM org_memberships om
                             WHERE om.org_id = p_org_id AND om.role = 'player')::text
                           || ' / ' || COALESCE(v_org.player_seat_limit::text, '∞'),
        'expires_on',      COALESCE(to_char(v_org.expires_at, 'FMMonth FMDD, YYYY'), 'never'),
        'org_admin_url',   COALESCE(v_app_url, 'https://app.scoutable.se') || '/admin/orgs/' || p_org_id
      )
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION request_license_renewal(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. update_org_license(): validation + audit + warning reset on renewal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_org_license(
  p_org_id       uuid,
  p_coach_seats  integer,
  p_player_seats integer,
  p_expires_at   timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old organizations%ROWTYPE;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  IF (p_coach_seats IS NOT NULL AND p_coach_seats < 0)
     OR (p_player_seats IS NOT NULL AND p_player_seats < 0) THEN
    RAISE EXCEPTION 'invalid_seat_limit';
  END IF;

  SELECT * INTO v_old FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  UPDATE organizations
    SET coach_seat_limit  = p_coach_seats,
        player_seat_limit = p_player_seats,
        expires_at        = p_expires_at
    WHERE id = p_org_id;

  -- A later expiry is a renewal: clear sent warnings so the new term gets
  -- its own 30/14/7/1/expired sequence.
  IF p_expires_at IS NULL
     OR (v_old.expires_at IS NOT NULL AND p_expires_at > v_old.expires_at) THEN
    DELETE FROM license_expiry_warnings WHERE org_id = p_org_id;
  END IF;

  INSERT INTO org_license_events (org_id, actor, event, old_values, new_values)
    VALUES (
      p_org_id, v_uid, 'license_updated',
      jsonb_build_object(
        'coach_seat_limit',  v_old.coach_seat_limit,
        'player_seat_limit', v_old.player_seat_limit,
        'expires_at',        v_old.expires_at
      ),
      jsonb_build_object(
        'coach_seat_limit',  p_coach_seats,
        'player_seat_limit', p_player_seats,
        'expires_at',        p_expires_at
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_license(uuid, integer, integer, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. create_org_for_platform(): one call sets plan, seats, expiry, contact.
--     The old 2-arg overload is dropped; PostgREST matches the new function
--     for old named-arg calls because the extra params have defaults.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_org_for_platform(text, boolean);

CREATE OR REPLACE FUNCTION create_org_for_platform(
  org_name        text,
  p_is_nt_org     boolean     DEFAULT false,
  p_plan_tier     text        DEFAULT 'franchise',
  p_coach_seats   integer     DEFAULT NULL,
  p_player_seats  integer     DEFAULT NULL,
  p_expires_at    timestamptz DEFAULT NULL,
  p_contact_name  text        DEFAULT NULL,
  p_contact_email text        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF p_plan_tier NOT IN ('free', 'rookie', 'pro', 'franchise') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;
  IF (p_coach_seats IS NOT NULL AND p_coach_seats < 0)
     OR (p_player_seats IS NOT NULL AND p_player_seats < 0) THEN
    RAISE EXCEPTION 'invalid_seat_limit';
  END IF;

  INSERT INTO organizations (
      name, is_nt_org, plan_tier, coach_seat_limit, player_seat_limit,
      expires_at, contact_name, contact_email)
    VALUES (
      org_name, p_is_nt_org, p_plan_tier, p_coach_seats, p_player_seats,
      p_expires_at, p_contact_name, p_contact_email)
    RETURNING id INTO v_org_id;

  INSERT INTO org_license_events (org_id, actor, event, new_values)
    VALUES (
      v_org_id, v_uid, 'org_created',
      jsonb_build_object(
        'plan_tier',         p_plan_tier,
        'coach_seat_limit',  p_coach_seats,
        'player_seat_limit', p_player_seats,
        'expires_at',        p_expires_at,
        'contact_email',     p_contact_email
      )
    );

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_org_for_platform(text, boolean, text, integer, integer, timestamptz, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. update_org_contact() + list_org_license_events()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_org_contact(
  p_org_id        uuid,
  p_contact_name  text,
  p_contact_email text,
  p_notes         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old organizations%ROWTYPE;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  SELECT * INTO v_old FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  UPDATE organizations
    SET contact_name  = p_contact_name,
        contact_email = p_contact_email,
        notes         = p_notes
    WHERE id = p_org_id;

  -- Notes edits are not audited (free text); contact changes are.
  IF v_old.contact_name IS DISTINCT FROM p_contact_name
     OR v_old.contact_email IS DISTINCT FROM p_contact_email THEN
    INSERT INTO org_license_events (org_id, actor, event, old_values, new_values)
      VALUES (
        p_org_id, v_uid, 'contact_updated',
        jsonb_build_object('contact_name', v_old.contact_name, 'contact_email', v_old.contact_email),
        jsonb_build_object('contact_name', p_contact_name, 'contact_email', p_contact_email)
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_contact(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION list_org_license_events(p_org_id uuid)
RETURNS TABLE (
  id         bigint,
  event      text,
  actor_name text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  RETURN QUERY
    SELECT e.id, e.event,
           COALESCE(p.full_name, _get_user_email(e.actor), 'System'),
           e.old_values, e.new_values, e.created_at
    FROM org_license_events e
    LEFT JOIN profiles p ON p.id = e.actor
    WHERE e.org_id = p_org_id
    ORDER BY e.created_at DESC
    LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION list_org_license_events(uuid) TO authenticated;

-- Audit plan-tier changes too (existing function, re-declared with audit row).
CREATE OR REPLACE FUNCTION update_org_plan_tier_for_platform(
  p_org_id uuid,
  p_tier   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_old_tier text;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF p_tier NOT IN ('free', 'rookie', 'pro', 'franchise') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;

  SELECT plan_tier INTO v_old_tier FROM organizations WHERE id = p_org_id;

  UPDATE organizations
  SET plan_tier = p_tier,
      plan_tier_locked_at = now()
  WHERE id = p_org_id;

  IF v_old_tier IS DISTINCT FROM p_tier THEN
    INSERT INTO org_license_events (org_id, actor, event, old_values, new_values)
      VALUES (p_org_id, v_uid, 'plan_tier_updated',
              jsonb_build_object('plan_tier', v_old_tier),
              jsonb_build_object('plan_tier', p_tier));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_plan_tier_for_platform(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Expiry checks in invite creation (the UI disable alone was bypassable
--     via direct RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_org_invite(
  p_org_id           uuid,
  p_role             text    DEFAULT 'coach',
  p_max_uses         integer DEFAULT NULL,
  p_expires_in_hours integer DEFAULT NULL,
  p_is_national_team boolean DEFAULT false,
  p_team_id          uuid    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_is_nt_org   boolean;
  v_expires     timestamptz;
  v_code        text;
BEGIN
  SELECT COALESCE(o.is_nt_org, false), o.expires_at INTO v_is_nt_org, v_expires
  FROM organizations o WHERE o.id = p_org_id;

  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role IN ('coach', 'player'))
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Platform admins can still mint codes (e.g. bootstrapping a renewal), but
  -- org members can't invite into an expired org.
  IF NOT is_platform_admin() AND v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'license_expired';
  END IF;

  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
  END LOOP;

  INSERT INTO org_invites (org_id, code, role, created_by, expires_at, max_uses, is_national_team, team_id)
    VALUES (
      p_org_id, v_code, p_role, v_uid,
      CASE WHEN p_expires_in_hours IS NOT NULL
           THEN now() + (p_expires_in_hours || ' hours')::interval
           ELSE NULL END,
      p_max_uses,
      CASE WHEN v_is_nt_org THEN true ELSE p_is_national_team END,
      p_team_id
    );

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_org_invite(uuid, text, integer, integer, boolean, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION send_org_invite_emails(
  p_org_id  uuid,
  p_emails  text[],
  p_role    text DEFAULT 'coach',
  p_team_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_is_nt_org   boolean;
  v_org_name    text;
  v_expires     timestamptz;
  v_app_url     text;
  v_email       text;
  v_code        text;
  v_sent        integer := 0;
BEGIN
  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role IN ('coach', 'player'))
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_role NOT IN ('coach', 'player', 'admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT name, COALESCE(is_nt_org, false), expires_at
  INTO v_org_name, v_is_nt_org, v_expires
  FROM organizations WHERE id = p_org_id;

  IF NOT is_platform_admin() AND v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'license_expired';
  END IF;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  FOREACH v_email IN ARRAY p_emails LOOP
    IF EXISTS (
      SELECT 1 FROM org_invites
      WHERE org_id = p_org_id AND email = v_email
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR used_count < max_uses)
    ) THEN
      CONTINUE;
    END IF;

    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
    END LOOP;

    INSERT INTO org_invites (org_id, code, role, email, created_by, max_uses, expires_at, is_national_team, team_id)
    VALUES (p_org_id, v_code, p_role, v_email, v_uid, 1, now() + interval '7 days', v_is_nt_org, p_team_id);

    PERFORM _send_notification_email(
      v_email,
      'org_invite',
      jsonb_build_object(
        'org_name',   v_org_name,
        'role',       p_role,
        'invite_url', v_app_url || '/join/' || v_code
      )
    );

    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$$;

GRANT EXECUTE ON FUNCTION send_org_invite_emails(uuid, text[], text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14. Grace-lock enforcement: past expiry + grace, org content is read-only.
--     Chokepoints: sharing playlists to org teams, creating teams, assigning
--     members to teams. Reads stay open (players keep watching film).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_license_on_share()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Clients sync shares with upsert, which re-inserts existing rows; only
  -- genuinely NEW shares are blocked so unsharing still works while locked.
  IF EXISTS (
    SELECT 1 FROM playlist_shares
    WHERE playlist_id = NEW.playlist_id AND team_id = NEW.team_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT org_id INTO v_org_id FROM teams WHERE id = NEW.team_id;
  IF v_org_id IS NOT NULL AND org_license_state(v_org_id) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_on_share ON playlist_shares;
CREATE TRIGGER trg_enforce_license_on_share
  BEFORE INSERT ON playlist_shares
  FOR EACH ROW EXECUTE FUNCTION enforce_license_on_share();

CREATE OR REPLACE FUNCTION create_team_for_org(
  team_name   text,
  team_season text DEFAULT NULL,
  p_org_id    uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_org_id       uuid;
  v_team_id      uuid;
  v_creator_role text;
BEGIN
  IF p_org_id IS NOT NULL THEN
    IF NOT is_platform_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM org_memberships
        WHERE user_id = v_uid AND org_id = p_org_id AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'not_admin';
      END IF;
    END IF;
    v_org_id := p_org_id;
  ELSE
    -- Backward compat: derive from profiles.org_id
    SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid AND role = 'admin';
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  IF NOT is_platform_admin() AND org_license_state(v_org_id) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;

  -- team_members.role only allows 'coach' | 'player'; admins join as coach
  SELECT CASE WHEN COALESCE(role, 'coach') = 'player' THEN 'player' ELSE 'coach' END
  INTO v_creator_role
  FROM org_memberships
  WHERE user_id = v_uid AND org_id = v_org_id;

  v_creator_role := COALESCE(v_creator_role, 'coach');

  INSERT INTO teams (org_id, name, season)
    VALUES (v_org_id, team_name, team_season)
    RETURNING id INTO v_team_id;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_team_id, v_uid, v_creator_role);

  RETURN v_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_team_for_org(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION assign_member_to_team(
  p_user_id uuid,
  p_team_id uuid,
  p_role    text DEFAULT 'player'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_team_org   uuid;
  v_user_email text;
  v_team_name  text;
  v_org_name   text;
BEGIN
  SELECT org_id INTO v_team_org FROM teams WHERE id = p_team_id;
  IF v_team_org IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_uid AND org_id = v_team_org AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
    IF org_license_state(v_team_org) = 'locked' THEN
      RAISE EXCEPTION 'license_locked';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = v_team_org
  ) THEN
    RAISE EXCEPTION 'user_or_team_not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, p_user_id, p_role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = p_role;

  -- Email restored (regressed in 20260427000001): notify the assigned member.
  v_user_email := _get_user_email(p_user_id);
  IF v_user_email IS NOT NULL THEN
    SELECT t.name, o.name INTO v_team_name, v_org_name
      FROM teams t JOIN organizations o ON o.id = t.org_id
      WHERE t.id = p_team_id;
    PERFORM _send_notification_email(
      v_user_email,
      'added_to_team',
      jsonb_build_object(
        'team_name', COALESCE(v_team_name, 'your team'),
        'org_name',  COALESCE(v_org_name, 'your organization')
      )
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_member_to_team(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 15. promote_to_admin(): coach seat check when promoting a player (closing
--     the cap bypass) + promoted_to_admin email restored (regressed in
--     20260427000001).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promote_to_admin(p_user_id uuid, p_org_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_org_id       uuid;
  v_target_role  text;
  v_seat_limit   integer;
  v_coach_count  integer;
  v_user_email   text;
  v_org_name     text;
BEGIN
  IF p_org_id IS NOT NULL THEN
    v_org_id := p_org_id;
  ELSE
    SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid;
  END IF;

  IF v_org_id IS NULL THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_uid AND org_id = v_org_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  SELECT role INTO v_target_role
    FROM org_memberships WHERE user_id = p_user_id AND org_id = v_org_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'user_not_in_org';
  END IF;

  -- Promoting a player consumes a coach seat (admins count against
  -- coach_seat_limit) — enforce the cap here like join_by_code does.
  IF v_target_role = 'player' THEN
    SELECT coach_seat_limit INTO v_seat_limit FROM organizations WHERE id = v_org_id;
    IF v_seat_limit IS NOT NULL THEN
      SELECT COUNT(*) INTO v_coach_count
        FROM org_memberships
        WHERE org_id = v_org_id AND role IN ('coach', 'admin') AND user_id != p_user_id;
      IF v_coach_count >= v_seat_limit THEN
        RAISE EXCEPTION 'coach_seat_limit_reached';
      END IF;
    END IF;
  END IF;

  UPDATE org_memberships SET role = 'admin'
    WHERE user_id = p_user_id AND org_id = v_org_id;

  -- Keep profiles.role in sync for primary org
  UPDATE profiles SET role = 'admin'
    WHERE id = p_user_id AND org_id = v_org_id;

  -- Email restored (regressed in 20260427000001): notify the promoted member.
  v_user_email := _get_user_email(p_user_id);
  IF v_user_email IS NOT NULL THEN
    SELECT name INTO v_org_name FROM organizations WHERE id = v_org_id;
    PERFORM _send_notification_email(
      v_user_email,
      'promoted_to_admin',
      jsonb_build_object('org_name', COALESCE(v_org_name, 'your organization'))
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION promote_to_admin(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 16a. join_by_code(): user_joined_org / added_to_team emails restored
--      (regressed in 20260505000004). Logic otherwise identical to that
--      version: additive joins, seat checks over org_memberships.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_code         text := upper(trim(p_code));
  v_org_invite   org_invites%ROWTYPE;
  v_team_invite  team_invites%ROWTYPE;
  v_org          organizations%ROWTYPE;
  v_org_id       uuid;
  v_coach_count  integer;
  v_player_count integer;
  v_was_member   boolean;
  v_user_email   text;
  v_user_name    text;
  v_admin_email  text;
  v_team_name    text;
  v_app_url      text;
BEGIN
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  -- Try org_invites first
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    -- Seat limit check (counts existing members, excluding self for re-join)
    IF v_org_invite.role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count
          FROM org_memberships
          WHERE org_id = v_org.id
            AND role IN ('coach', 'admin')
            AND user_id != v_uid;
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_org_invite.role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count
          FROM org_memberships
          WHERE org_id = v_org.id
            AND role = 'player'
            AND user_id != v_uid;
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
    END IF;

    v_was_member := EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id
    );

    -- Additive join — no primary/secondary distinction, no profiles.org_id write
    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org.id, v_org_invite.role)
      ON CONFLICT (user_id, org_id) DO UPDATE SET role =
        CASE WHEN v_org_invite.role = 'admin' THEN 'admin'
             WHEN org_memberships.role = 'admin' THEN 'admin'
             ELSE v_org_invite.role END;

    IF v_org_invite.team_id IS NOT NULL THEN
      INSERT INTO team_members (team_id, user_id, role)
        VALUES (v_org_invite.team_id, v_uid, v_org_invite.role)
        ON CONFLICT (team_id, user_id) DO NOTHING;
    END IF;

    UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;

    -- Email: notify org admins about first-time joins
    IF NOT v_was_member THEN
      SELECT u.email, p.full_name INTO v_user_email, v_user_name
        FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
        WHERE u.id = v_uid;
      FOR v_admin_email IN SELECT * FROM _get_org_admin_emails(v_org.id) LOOP
        IF v_admin_email != v_user_email THEN
          PERFORM _send_notification_email(
            v_admin_email,
            'user_joined_org',
            jsonb_build_object(
              'user_name', COALESCE(v_user_name, v_user_email, 'A new user'),
              'org_name',  COALESCE(v_org.name, 'your organization'),
              'org_url',   v_app_url || '/organization'
            )
          );
        END IF;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('type', 'org', 'org_id', v_org.id);
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    SELECT t.org_id INTO v_org_id FROM teams t WHERE t.id = v_team_invite.team_id;
    SELECT * INTO v_org FROM organizations WHERE id = v_org_id;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    -- Seat limit check
    IF v_team_invite.role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count
          FROM org_memberships
          WHERE org_id = v_org_id
            AND role IN ('coach', 'admin')
            AND user_id != v_uid;
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_team_invite.role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count
          FROM org_memberships
          WHERE org_id = v_org_id
            AND role = 'player'
            AND user_id != v_uid;
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
    END IF;

    v_was_member := EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org_id
    );

    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org_id, v_team_invite.role)
      ON CONFLICT (user_id, org_id) DO NOTHING;

    INSERT INTO team_members (team_id, user_id, role)
      VALUES (v_team_invite.team_id, v_uid, v_team_invite.role)
      ON CONFLICT (team_id, user_id) DO NOTHING;

    UPDATE team_invites SET used_count = used_count + 1 WHERE id = v_team_invite.id;

    -- Emails: welcome the member to the team; tell admins about first joins
    SELECT u.email, p.full_name INTO v_user_email, v_user_name
      FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
      WHERE u.id = v_uid;
    SELECT name INTO v_team_name FROM teams WHERE id = v_team_invite.team_id;

    IF v_user_email IS NOT NULL THEN
      PERFORM _send_notification_email(
        v_user_email,
        'added_to_team',
        jsonb_build_object(
          'team_name', COALESCE(v_team_name, 'your team'),
          'org_name',  COALESCE(v_org.name, 'your organization')
        )
      );
    END IF;

    IF NOT v_was_member THEN
      FOR v_admin_email IN SELECT * FROM _get_org_admin_emails(v_org_id) LOOP
        IF v_admin_email != v_user_email THEN
          PERFORM _send_notification_email(
            v_admin_email,
            'user_joined_org',
            jsonb_build_object(
              'user_name', COALESCE(v_user_name, v_user_email, 'A new user'),
              'org_name',  COALESCE(v_org.name, 'your organization'),
              'org_url',   v_app_url || '/organization'
            )
          );
        END IF;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('type', 'team', 'org_id', v_org_id, 'team_id', v_team_invite.team_id);
  END IF;

  RAISE EXCEPTION 'invalid_code';
END;
$$;

GRANT EXECUTE ON FUNCTION join_by_code(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 16b. remove_member_from_org(): removed_from_org email restored (regressed
--      in the 20260505000003 rewrite). Logic otherwise identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member_from_org(p_user_id uuid, p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_primary_org uuid;
  v_user_email  text;
  v_org_name    text;
BEGIN
  IF NOT is_platform_admin() THEN
    SELECT role INTO v_caller_role
    FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id) THEN
      RAISE EXCEPTION 'user_not_in_org';
    END IF;
  END IF;

  -- Capture email and org name before removing
  v_user_email := _get_user_email(p_user_id);
  SELECT name INTO v_org_name FROM organizations WHERE id = p_org_id;

  -- Always remove from team_members in this org (primary or secondary)
  DELETE FROM team_members
    WHERE user_id = p_user_id
      AND team_id IN (SELECT id FROM teams WHERE org_id = p_org_id);

  -- Only detach profiles.org_id when this is the user's primary org
  SELECT org_id INTO v_primary_org FROM profiles WHERE id = p_user_id;
  IF v_primary_org = p_org_id THEN
    UPDATE profiles SET org_id = NULL, role = 'coach' WHERE id = p_user_id;
  END IF;

  DELETE FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id;

  -- Email restored (regressed in 20260505000003): notify the removed member.
  IF v_user_email IS NOT NULL AND v_org_name IS NOT NULL THEN
    PERFORM _send_notification_email(
      v_user_email,
      'removed_from_org',
      jsonb_build_object('org_name', v_org_name)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_member_from_org(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 16c. get_invite_preview(): seat-cap surfaced at preview time. Unlike
--      join_by_code's exception path (where pg_net inserts roll back), this
--      function returns normally, so the seat_limit_reached notification can
--      actually send. Deduped to one per org/role/day via seat_limit_hits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _notify_seat_limit_hit(p_org_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      organizations%ROWTYPE;
  v_email    text;
  v_app_url  text;
  v_limit    integer;
  v_inserted integer;
BEGIN
  INSERT INTO seat_limit_hits (org_id, role, hit_date)
    VALUES (p_org_id, p_role, current_date)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN; END IF;  -- already notified today

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  v_limit := CASE WHEN p_role = 'coach' THEN v_org.coach_seat_limit
                  ELSE v_org.player_seat_limit END;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  FOR v_email IN
    SELECT DISTINCT e FROM (
      SELECT _get_org_admin_emails(p_org_id) AS e
      UNION SELECT _get_platform_admin_emails()
    ) emails WHERE e IS NOT NULL AND e != ''
  LOOP
    PERFORM _send_notification_email(
      v_email,
      'seat_limit_reached',
      jsonb_build_object(
        'org_name',   v_org.name,
        'role',       p_role,
        'seat_limit', COALESCE(v_limit::text, '?'),
        'org_url',    v_app_url || '/organization'
      )
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[license] _notify_seat_limit_hit failed for org %: %', p_org_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION get_invite_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_code        text := upper(trim(p_code));
  v_org_invite  org_invites%ROWTYPE;
  v_team_invite team_invites%ROWTYPE;
  v_org_name    text;
  v_team_name   text;
  v_org         organizations%ROWTYPE;
  v_seat_role   text;
  v_count       integer;
  v_limit       integer;
BEGIN
  -- Try org_invites
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code;
  IF FOUND THEN
    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_invite');
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;

    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_license');
    END IF;

    -- Seat check — skipped for existing members (re-joins are allowed by
    -- join_by_code, which excludes self from the count).
    IF v_uid IS NULL OR NOT EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id
    ) THEN
      v_seat_role := CASE WHEN v_org_invite.role IN ('coach', 'admin') THEN 'coach' ELSE 'player' END;
      v_limit := CASE WHEN v_seat_role = 'coach' THEN v_org.coach_seat_limit ELSE v_org.player_seat_limit END;
      IF v_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count FROM org_memberships
          WHERE org_id = v_org.id
            AND CASE WHEN v_seat_role = 'coach' THEN role IN ('coach', 'admin') ELSE role = 'player' END;
        IF v_count >= v_limit THEN
          PERFORM _notify_seat_limit_hit(v_org.id, v_seat_role);
          RETURN jsonb_build_object('valid', false, 'reason', 'seat_limit_reached');
        END IF;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'valid',     true,
      'org_name',  v_org.name,
      'team_name', null::text,
      'role',      v_org_invite.role,
      'email',     v_org_invite.email
    );
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code;
  IF FOUND THEN
    IF v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_invite');
    END IF;
    IF v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;

    SELECT o.name, t.name INTO v_org_name, v_team_name
      FROM teams t JOIN organizations o ON o.id = t.org_id
      WHERE t.id = v_team_invite.team_id;

    SELECT * INTO v_org FROM organizations
      WHERE id = (SELECT org_id FROM teams WHERE id = v_team_invite.team_id);
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_license');
    END IF;

    IF v_uid IS NULL OR NOT EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id
    ) THEN
      v_seat_role := CASE WHEN v_team_invite.role IN ('coach', 'admin') THEN 'coach' ELSE 'player' END;
      v_limit := CASE WHEN v_seat_role = 'coach' THEN v_org.coach_seat_limit ELSE v_org.player_seat_limit END;
      IF v_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count FROM org_memberships
          WHERE org_id = v_org.id
            AND CASE WHEN v_seat_role = 'coach' THEN role IN ('coach', 'admin') ELSE role = 'player' END;
        IF v_count >= v_limit THEN
          PERFORM _notify_seat_limit_hit(v_org.id, v_seat_role);
          RETURN jsonb_build_object('valid', false, 'reason', 'seat_limit_reached');
        END IF;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'valid',     true,
      'org_name',  v_org_name,
      'team_name', v_team_name,
      'role',      v_team_invite.role
    );
  END IF;

  RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
END;
$$;

GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO anon;
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 17. get_all_orgs_with_counts(): license columns for the /admin list
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_all_orgs_with_counts();
CREATE OR REPLACE FUNCTION get_all_orgs_with_counts()
RETURNS TABLE (
  id                  uuid,
  name                text,
  logo_url            text,
  created_at          timestamptz,
  member_count        bigint,
  team_count          bigint,
  plan_tier           text,
  plan_tier_locked_at timestamptz,
  is_personal         boolean,
  owner_email         text,
  expires_at          timestamptz,
  coach_seat_limit    integer,
  player_seat_limit   integer,
  coach_count         bigint,
  player_count        bigint,
  contact_email       text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  RETURN QUERY
    SELECT
      o.id,
      o.name,
      o.logo_url,
      o.created_at,
      COUNT(DISTINCT om.user_id)::bigint AS member_count,
      COUNT(DISTINCT t.id)::bigint       AS team_count,
      o.plan_tier,
      o.plan_tier_locked_at,
      COALESCE(o.is_personal, false)     AS is_personal,
      CASE
        WHEN COALESCE(o.is_personal, false) THEN (
          SELECT u.email::text
          FROM org_memberships om2
          JOIN auth.users u ON u.id = om2.user_id
          WHERE om2.org_id = o.id AND om2.role = 'admin'
          ORDER BY om2.joined_at ASC
          LIMIT 1
        )
        ELSE NULL
      END                                AS owner_email,
      o.expires_at,
      o.coach_seat_limit,
      o.player_seat_limit,
      COUNT(DISTINCT om.user_id) FILTER (WHERE om.role IN ('coach', 'admin'))::bigint AS coach_count,
      COUNT(DISTINCT om.user_id) FILTER (WHERE om.role = 'player')::bigint            AS player_count,
      o.contact_email
    FROM organizations o
    LEFT JOIN org_memberships om ON om.org_id = o.id
    LEFT JOIN teams t            ON t.org_id  = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at, o.plan_tier,
             o.plan_tier_locked_at, o.is_personal, o.expires_at,
             o.coach_seat_limit, o.player_seat_limit, o.contact_email
    ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_orgs_with_counts() TO authenticated;

-- ---------------------------------------------------------------------------
-- 17b. get_my_orgs(): expose expires_at so every app can show license
--      banners for the active org without an extra fetch. Ordering from
--      20260829100000 preserved.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_my_orgs();
CREATE OR REPLACE FUNCTION get_my_orgs()
RETURNS TABLE (
  org_id uuid, org_name text, role text, is_nt_org boolean,
  plan_tier text, is_personal boolean, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id, o.name, om.role, COALESCE(o.is_nt_org, false),
         o.plan_tier, o.is_personal, o.expires_at
  FROM org_memberships om JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = (SELECT auth.uid())
  ORDER BY o.is_personal ASC, o.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_my_orgs() TO authenticated;

-- get_my_secondary_orgs is a backward-compat alias over get_my_orgs; its
-- return type must match (drop-and-recreate for the new column).
DROP FUNCTION IF EXISTS get_my_secondary_orgs();
CREATE OR REPLACE FUNCTION get_my_secondary_orgs()
RETURNS TABLE (
  org_id uuid, org_name text, role text, is_nt_org boolean,
  plan_tier text, is_personal boolean, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM get_my_orgs();
$$;

GRANT EXECUTE ON FUNCTION get_my_secondary_orgs() TO authenticated;

-- ---------------------------------------------------------------------------
-- 18. Cron schedules (idempotent; no-op where pg_cron isn't installed, e.g.
--     local dev). Verify in the dashboard that both jobs exist in production.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname IN ('notify-license-expiry', 'license-digest-weekly');
    PERFORM cron.schedule('notify-license-expiry', '0 9 * * *',
      'SELECT notify_expiring_licenses()');
    PERFORM cron.schedule('license-digest-weekly', '0 9 * * 1',
      'SELECT notify_platform_license_digest()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule notify-license-expiry and license-digest-weekly manually';
  END IF;
END;
$$;
