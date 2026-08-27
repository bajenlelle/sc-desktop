-- =============================================================================
-- Import quota rework: Free lifetime cap, grants engine, server enforcement.
--
-- Free changes from 2 imports/month to 3 game imports TOTAL (trial
-- semantics; the monthly drip quietly gave away 24 games a year). Rookie
-- stays 10/month. Limits now live in ONE place (_import_allowance) instead
-- of being duplicated across five client files, enforcement moves into the
-- import trigger (the old check was client-side only), and platform admins
-- can grant bonus imports — per user (re-activation) or to everyone
-- (season-start campaigns) — within a date window.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Bonus import grants. user_id NULL = applies to every user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_grants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  amount     int NOT NULL CHECK (amount > 0),
  reason     text,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE import_grants ENABLE ROW LEVEL SECURITY;

-- Users may see grants that apply to them (their own + global campaigns);
-- all writes go through the platform-admin RPCs below.
CREATE POLICY import_grants_select_applicable ON import_grants
  FOR SELECT USING (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- The single source of truth for import limits.
--   free    → 3 imports, lifetime window
--   rookie  → 10 imports, calendar-month window
--   pro / franchise → unlimited
-- Active grants add to the effective limit while their window is open; when
-- a grant expires the remaining allowance simply shrinks (used imports are
-- never invalidated — clients floor remaining at 0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _import_allowance(p_user uuid, p_org uuid)
RETURNS TABLE (tier text, win text, base_limit int, bonus int, used int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier  text;
  v_win   text;
  v_base  int;
  -- Same values as NT_LEAGUE_IDS in packages/shared/lib/plan-tier.ts —
  -- national-team imports never count against the quota.
  v_nt    text[] := ARRAY['sweden-national-men', 'sweden-national-women'];
BEGIN
  SELECT o.plan_tier INTO v_tier FROM organizations o WHERE o.id = p_org;
  v_tier := COALESCE(v_tier, 'free');

  IF v_tier = 'free' THEN
    v_win := 'lifetime'; v_base := 3;
  ELSIF v_tier = 'rookie' THEN
    v_win := 'month'; v_base := 10;
  ELSE
    v_win := 'unlimited'; v_base := NULL;
  END IF;

  RETURN QUERY SELECT
    v_tier,
    v_win,
    v_base,
    (SELECT COALESCE(SUM(g.amount), 0)::int FROM import_grants g
      WHERE (g.user_id IS NULL OR g.user_id = p_user)
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())),
    (SELECT COUNT(*)::int FROM import_log il
      WHERE il.user_id = p_user
        AND (p_org IS NULL OR il.org_id = p_org)
        AND (il.league_id IS NULL OR NOT (il.league_id = ANY(v_nt)))
        AND (v_win <> 'month' OR il.created_at >= date_trunc('month', now())));
END;
$$;

-- ---------------------------------------------------------------------------
-- Client-facing quota read — what the meters display.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_import_quota(p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_limit int;
BEGIN
  SELECT * INTO v FROM _import_allowance(auth.uid(), p_org_id);
  IF v.base_limit IS NULL THEN
    RETURN jsonb_build_object(
      'tier', v.tier, 'window', v.win, 'base_limit', NULL, 'bonus', v.bonus,
      'limit', NULL, 'used', v.used, 'remaining', NULL);
  END IF;
  v_limit := v.base_limit + v.bonus;
  RETURN jsonb_build_object(
    'tier', v.tier, 'window', v.win, 'base_limit', v.base_limit,
    'bonus', v.bonus, 'limit', v_limit, 'used', v.used,
    'remaining', GREATEST(0, v_limit - v.used));
END;
$$;

GRANT EXECUTE ON FUNCTION get_import_quota(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Server-side enforcement. The client precheck is UX; this is the gate.
-- Demo games and NT-league imports stay exempt; a duplicate of an already
-- logged game (same game_key) is always allowed — it consumed its slot when
-- first imported.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_match_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
  v_nt text[] := ARRAY['sweden-national-men', 'sweden-national-women'];
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW;
  END IF;

  IF NEW.league_id IS NULL OR NOT (NEW.league_id = ANY(v_nt)) THEN
    -- Re-import of an already-counted game is free — check before charging.
    IF NOT EXISTS (
      SELECT 1 FROM import_log
        WHERE user_id = NEW.user_id
          AND game_key = COALESCE(NEW.source_game_id, NEW.id)
    ) THEN
      SELECT * INTO v FROM _import_allowance(NEW.user_id, NEW.org_id);
      IF v.base_limit IS NOT NULL AND v.used >= v.base_limit + v.bonus THEN
        RAISE EXCEPTION 'import_limit_reached';
      END IF;
    END IF;
  END IF;

  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key, created_at)
  VALUES (NEW.user_id, NEW.org_id, NEW.id, NEW.league_id,
          COALESCE(NEW.source_game_id, NEW.id), NEW.created_at)
  ON CONFLICT (user_id, game_key) DO NOTHING;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Platform-admin grant management (used by the /admin "Import grants" card).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_import_credits(
  p_email text,
  p_amount int,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_target uuid;
  v_id     uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF p_email IS NOT NULL THEN
    SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(p_email);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'user_not_found';
    END IF;
  END IF;
  INSERT INTO import_grants (user_id, amount, reason, expires_at, created_by)
    VALUES (v_target, p_amount, p_reason, p_expires_at, v_uid)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION grant_import_credits(text, int, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_import_grant(p_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  DELETE FROM import_grants WHERE id = p_grant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_import_grant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION list_import_grants()
RETURNS TABLE (
  id uuid,
  user_email text,
  amount int,
  reason text,
  starts_at timestamptz,
  expires_at timestamptz,
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
    SELECT g.id, u.email::text, g.amount, g.reason, g.starts_at, g.expires_at, g.created_at
      FROM import_grants g
      LEFT JOIN auth.users u ON u.id = g.user_id
      WHERE g.expires_at IS NULL OR g.expires_at > now()
      ORDER BY g.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION list_import_grants() TO authenticated;
