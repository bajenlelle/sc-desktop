-- The org_invites RLS policies query org_memberships, but org_memberships' own
-- "admin can read all memberships in their org" policy queries org_memberships
-- again → infinite recursion. Wrap the membership lookups in SECURITY DEFINER
-- helpers so RLS isn't re-evaluated when the policy fires.

CREATE OR REPLACE FUNCTION is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = (SELECT auth.uid())
      AND org_id  = p_org_id
      AND role    = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION is_org_admin_or_coach(p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = (SELECT auth.uid())
      AND org_id  = p_org_id
      AND role    IN ('admin', 'coach')
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_admin(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin_or_coach(uuid) TO authenticated;

-- Replace the recursive policies with helper-backed ones.

DROP POLICY IF EXISTS org_invites_delete_admin ON org_invites;
CREATE POLICY org_invites_delete_admin ON org_invites
  FOR DELETE USING (
    is_platform_admin() OR is_org_admin(org_id)
  );

DROP POLICY IF EXISTS org_invites_insert_admin ON org_invites;
CREATE POLICY org_invites_insert_admin ON org_invites
  FOR INSERT WITH CHECK (
    is_platform_admin() OR is_org_admin_or_coach(org_id)
  );
