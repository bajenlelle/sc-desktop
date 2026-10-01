-- =============================================================================
-- Free-import refills for users who used up the free tier
--
-- PRODUCT.md (2026-10-01): users who have used all their free imports and not
-- upgraded get them topped up after a while, so a coach who wasn't ready to
-- pay keeps a way back in without running a whole season for free.
--
-- Manual for now: platform admins see the candidates in /admin and refill
-- one user at a time. A refill is an ordinary import_grants row, so
-- _import_allowance needs no change. It expires, so unused imports lapse and
-- never stack onto a later Rookie month. When volume justifies it, a cron
-- job can loop free_refill_candidates() with the same refill function.
--
-- The refill email carries an upgrade offer, which makes it marketing: it
-- goes only to users with marketing consent (20261001110000). Everyone else
-- still gets the imports, and the app's quota chip shows them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings: one row. The seeded numbers are placeholders until Leonard
--    decides; change them in /admin.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS free_refill_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  amount        integer NOT NULL CHECK (amount BETWEEN 1 AND 50),
  wait_days     integer NOT NULL CHECK (wait_days >= 0),      -- after the last free import
  expires_days  integer NOT NULL CHECK (expires_days >= 1),   -- the grant lapses after this
  cooldown_days integer NOT NULL CHECK (cooldown_days >= 0),  -- minimum gap between refills
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);
ALTER TABLE free_refill_settings ENABLE ROW LEVEL SECURITY;  -- RPC access only

INSERT INTO free_refill_settings (amount, wait_days, expires_days, cooldown_days)
VALUES (2, 30, 60, 90)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Ledger: drives the cooldown and the history in /admin.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS free_refills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_id    uuid REFERENCES import_grants(id) ON DELETE SET NULL,
  amount      integer NOT NULL,
  expires_at  timestamptz NOT NULL,
  refilled_at timestamptz NOT NULL DEFAULT now(),
  refilled_by uuid,
  emailed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS free_refills_user_idx ON free_refills (user_id, refilled_at DESC);
ALTER TABLE free_refills ENABLE ROW LEVEL SECURITY;  -- RPC access only

-- ---------------------------------------------------------------------------
-- 3. Settings RPCs (platform admin).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_free_refill_settings()
RETURNS free_refill_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row free_refill_settings;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT * INTO v_row FROM free_refill_settings WHERE id;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION update_free_refill_settings(
  p_amount integer, p_wait_days integer, p_expires_days integer, p_cooldown_days integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE free_refill_settings
     SET amount = p_amount, wait_days = p_wait_days, expires_days = p_expires_days,
         cooldown_days = p_cooldown_days, updated_at = now(), updated_by = auth.uid()
   WHERE id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Candidates: free personal space, plan not admin-locked, every free
--    import used (grants included, so a live refill takes them off the list).
--    Club members are listed but flagged: they import without limit in the
--    club's space. Internal _free_refill_rows is shared with the refill RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _free_refill_rows()
RETURNS TABLE (
  user_id          uuid,
  email            text,
  full_name        text,
  declared_role    text,
  used             integer,
  allowance        integer,
  last_import_at   timestamptz,
  last_sign_in_at  timestamptz,
  in_club          boolean,
  had_subscription boolean,
  email_consent    boolean,
  last_refill_at   timestamptz,
  eligible_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM free_refill_settings WHERE id),
  p AS (
    SELECT om.user_id, o.id AS org_id
      FROM org_memberships om
      JOIN organizations o ON o.id = om.org_id
     WHERE o.is_personal
       AND COALESCE(o.plan_tier, 'free') = 'free'
       AND o.plan_tier_locked_at IS NULL
  ),
  ex AS (
    SELECT p.user_id, p.org_id, a.used, a.base_limit + a.bonus AS allowance
      FROM p, LATERAL _import_allowance(p.user_id, p.org_id) a
     WHERE a.used >= a.base_limit + a.bonus
  ),
  r AS (
    SELECT ex.*,
           (SELECT max(il.created_at) FROM import_log il
             WHERE il.user_id = ex.user_id AND il.org_id = ex.org_id) AS last_import_at,
           (SELECT max(fr.refilled_at) FROM free_refills fr
             WHERE fr.user_id = ex.user_id) AS last_refill_at
      FROM ex
  )
  SELECT r.user_id,
         u.email::text,
         pr.full_name,
         pr.declared_role,
         r.used,
         r.allowance,
         r.last_import_at,
         u.last_sign_in_at,
         EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                  WHERE m.user_id = r.user_id AND NOT o.is_personal),
         EXISTS (SELECT 1 FROM stripe_customers sc WHERE lower(sc.email) = lower(u.email)),
         COALESCE(ep.marketing_consent_at IS NOT NULL, false),
         r.last_refill_at,
         GREATEST(r.last_import_at + make_interval(days => s.wait_days),
                  r.last_refill_at + make_interval(days => s.cooldown_days))
    FROM r
    CROSS JOIN s
    JOIN auth.users u ON u.id = r.user_id
    LEFT JOIN profiles pr ON pr.id = r.user_id
    LEFT JOIN email_preferences ep ON ep.user_id = r.user_id
   WHERE NOT COALESCE(pr.is_platform_admin, false);
$$;

REVOKE EXECUTE ON FUNCTION _free_refill_rows() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION free_refill_candidates()
RETURNS TABLE (
  user_id          uuid,
  email            text,
  full_name        text,
  declared_role    text,
  used             integer,
  allowance        integer,
  last_import_at   timestamptz,
  last_sign_in_at  timestamptz,
  in_club          boolean,
  had_subscription boolean,
  email_consent    boolean,
  last_refill_at   timestamptz,
  eligible_at      timestamptz,
  eligible_now     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN QUERY
    SELECT f.*, COALESCE(f.eligible_at <= now(), true)
      FROM _free_refill_rows() f
     ORDER BY f.eligible_at NULLS FIRST, f.last_import_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Refill one user. p_force skips the wait and cooldown (still only for a
--    current candidate), for a deliberate manual exception.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refill_free_imports(p_user_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_set      free_refill_settings;
  v_row      record;
  v_expires  timestamptz;
  v_grant_id uuid;
  v_unsub    text;
  v_app_url  text;
  v_emailed  boolean := false;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  -- One refill at a time per user, so a double click can't grant twice.
  PERFORM pg_advisory_xact_lock(hashtextextended('free_refill:' || p_user_id::text, 0));

  SELECT * INTO v_set FROM free_refill_settings WHERE id;
  SELECT * INTO v_row FROM _free_refill_rows() f WHERE f.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_eligible';  -- not on free, plan locked, or imports left
  END IF;

  IF NOT p_force AND v_row.eligible_at IS NOT NULL AND v_row.eligible_at > now() THEN
    IF v_row.last_refill_at IS NOT NULL
       AND v_row.last_refill_at + make_interval(days => v_set.cooldown_days) > now() THEN
      RAISE EXCEPTION 'refilled_recently';
    END IF;
    RAISE EXCEPTION 'too_soon';
  END IF;

  v_expires := now() + make_interval(days => v_set.expires_days);

  INSERT INTO import_grants (user_id, amount, reason, expires_at, created_by)
  VALUES (p_user_id, v_set.amount, 'free_refill', v_expires, v_uid)
  RETURNING id INTO v_grant_id;

  INSERT INTO free_refills (user_id, grant_id, amount, expires_at, refilled_by)
  VALUES (p_user_id, v_grant_id, v_set.amount, v_expires, v_uid);

  -- Marketing email only with consent; the helper returns NULL otherwise.
  v_unsub := _marketing_unsubscribe_url(p_user_id);
  IF v_unsub IS NOT NULL THEN
    SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
    PERFORM _send_notification_email(
      v_row.email,
      'free_refill',
      jsonb_strip_nulls(jsonb_build_object(
        'name',            NULLIF(split_part(COALESCE(v_row.full_name, ''), ' ', 1), ''),
        'amount',          v_set.amount::text,
        'expires_on',      to_char(v_expires AT TIME ZONE 'Europe/Stockholm', 'FMDD FMMonth YYYY'),
        'app_url',         COALESCE(v_app_url, 'https://app.scoutable.se'),
        'pricing_url',     'https://scoutable.se/pricing?utm_source=email&utm_medium=lifecycle&utm_campaign=free_refill',
        'unsubscribe_url', v_unsub
      ))
    );
    UPDATE free_refills SET emailed_at = now()
     WHERE grant_id = v_grant_id;
    v_emailed := true;
  END IF;

  RETURN jsonb_build_object('granted', v_set.amount, 'expires_at', v_expires, 'emailed', v_emailed);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_free_refill_settings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION update_free_refill_settings(integer, integer, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION free_refill_candidates() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION refill_free_imports(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_free_refill_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION update_free_refill_settings(integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION free_refill_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION refill_free_imports(uuid, boolean) TO authenticated;
