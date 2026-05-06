-- Option B: admin overrides on organizations.plan_tier should not be clobbered
-- by the Stripe webhook. Track lock state on the org; when locked, the webhook
-- skips the org. Admin can clear the lock to hand control back to Stripe.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_tier_locked_at timestamptz;

-- Admin sets plan_tier AND locks it.
CREATE OR REPLACE FUNCTION update_org_plan_tier_for_platform(
  p_org_id uuid,
  p_tier   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF p_tier NOT IN ('free', 'rookie', 'pro', 'franchise') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;
  UPDATE organizations
  SET plan_tier = p_tier,
      plan_tier_locked_at = now()
  WHERE id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_plan_tier_for_platform(uuid, text) TO authenticated;

-- Admin clears the lock — next Stripe webhook event will resync plan_tier.
CREATE OR REPLACE FUNCTION unlock_org_plan_tier_for_platform(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  UPDATE organizations
  SET plan_tier_locked_at = NULL
  WHERE id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION unlock_org_plan_tier_for_platform(uuid) TO authenticated;

-- Stripe webhook honours the lock: only update plan_tier on personal orgs that
-- aren't admin-locked.
CREATE OR REPLACE FUNCTION set_personal_org_plan_tier(p_user_id uuid, p_tier text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_tier NOT IN ('free', 'rookie', 'pro') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;
  UPDATE organizations
  SET plan_tier = p_tier
  WHERE id IN (
    SELECT om.org_id FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = p_user_id AND o.is_personal = true
  )
    AND plan_tier_locked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION set_personal_org_plan_tier(uuid, text) TO service_role;

-- Surface lock state to the platform admin dashboard.
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
  owner_email         text
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
      END                                AS owner_email
    FROM organizations o
    LEFT JOIN org_memberships om ON om.org_id = o.id
    LEFT JOIN teams t            ON t.org_id  = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at, o.plan_tier, o.plan_tier_locked_at, o.is_personal
    ORDER BY o.created_at DESC;
END;
$$;
