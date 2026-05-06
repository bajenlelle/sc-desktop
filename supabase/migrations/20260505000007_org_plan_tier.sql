-- Add plan_tier to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free'
  CHECK (plan_tier IN ('free', 'pro', 'max', 'franchise'));

-- Update get_my_orgs() to return plan_tier
DROP FUNCTION IF EXISTS get_my_orgs();
CREATE OR REPLACE FUNCTION get_my_orgs()
RETURNS TABLE (org_id uuid, org_name text, role text, is_nt_org boolean, plan_tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id, o.name, om.role, COALESCE(o.is_nt_org, false), o.plan_tier
  FROM org_memberships om JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = (SELECT auth.uid());
$$;

-- Update get_all_orgs_with_counts() to return plan_tier
DROP FUNCTION IF EXISTS get_all_orgs_with_counts();
CREATE OR REPLACE FUNCTION get_all_orgs_with_counts()
RETURNS TABLE (
  id uuid, name text, logo_url text, created_at timestamptz,
  member_count bigint, team_count bigint, plan_tier text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.logo_url, o.created_at,
           COUNT(DISTINCT om.user_id)::bigint,
           COUNT(DISTINCT t.id)::bigint,
           o.plan_tier
    FROM organizations o
    LEFT JOIN org_memberships om ON om.org_id = o.id
    LEFT JOIN teams t ON t.org_id = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at, o.plan_tier
    ORDER BY o.created_at DESC;
END;
$$;

-- Update count_club_matches_this_month to support per-org counting
CREATE OR REPLACE FUNCTION count_club_matches_this_month(
  p_nt_league_ids text[] DEFAULT '{}',
  p_org_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::integer FROM matches
  WHERE user_id = auth.uid()
    AND created_at >= date_trunc('month', now())
    AND (p_org_id IS NULL OR org_id = p_org_id)
    AND (league_id IS NULL OR NOT (league_id = ANY(p_nt_league_ids)));
$$;
