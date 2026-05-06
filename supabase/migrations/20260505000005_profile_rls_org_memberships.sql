-- Update profiles visibility RLS to use org_memberships instead of profiles.org_id.
--
-- The old policy checked profiles.org_id (primary org only), so secondary org members
-- couldn't see each other's profiles. The new policy uses a SECURITY DEFINER helper
-- (same pattern as current_user_team_ids) to avoid RLS recursion on org_memberships.

CREATE OR REPLACE FUNCTION current_user_org_peer_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT om2.user_id
  FROM org_memberships om1
  JOIN org_memberships om2 ON om1.org_id = om2.org_id
  WHERE om1.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION current_user_org_peer_ids() TO authenticated;

DROP POLICY IF EXISTS profiles_select_own_or_same_org ON profiles;
CREATE POLICY profiles_select_own_or_same_org ON profiles
  FOR SELECT USING (
    id = (SELECT auth.uid())
    OR id IN (SELECT current_user_org_peer_ids())
  );
