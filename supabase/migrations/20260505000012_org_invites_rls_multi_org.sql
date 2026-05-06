-- Update org_invites RLS to use org_memberships (multi-org model) instead of
-- profiles.org_id + profiles.role. Without this, an admin whose profiles.org_id
-- doesn't equal the target org (e.g. it's their personal org) can't DELETE an
-- invite for an org they admin via org_memberships.

DROP POLICY IF EXISTS org_invites_delete_admin ON org_invites;
CREATE POLICY org_invites_delete_admin ON org_invites
  FOR DELETE USING (
    is_platform_admin()
    OR org_id IN (
      SELECT om.org_id FROM org_memberships om
      WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'admin'
    )
  );

DROP POLICY IF EXISTS org_invites_insert_admin ON org_invites;
CREATE POLICY org_invites_insert_admin ON org_invites
  FOR INSERT WITH CHECK (
    is_platform_admin()
    OR org_id IN (
      SELECT om.org_id FROM org_memberships om
      WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('admin', 'coach')
    )
  );
