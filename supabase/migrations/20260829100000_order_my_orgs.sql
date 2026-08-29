-- =============================================================================
-- Deterministic org ordering: get_my_orgs() had no ORDER BY, so clients
-- falling back to orgs[0] (no stored active-space choice) usually landed on
-- the personal org — created first at signup — instead of the club. Club
-- orgs now come first, oldest first, personal last. Web also sorts
-- client-side; this fixes desktop and mobile, which share the RPC and the
-- same orgs[0] fallback.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_my_orgs()
RETURNS TABLE (org_id uuid, org_name text, role text, is_nt_org boolean, plan_tier text, is_personal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id, o.name, om.role, COALESCE(o.is_nt_org, false), o.plan_tier, o.is_personal
  FROM org_memberships om JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = (SELECT auth.uid())
  ORDER BY o.is_personal ASC, o.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_my_orgs() TO authenticated;
