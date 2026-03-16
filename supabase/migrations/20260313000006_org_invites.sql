CREATE TABLE org_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'coach' CHECK (role IN ('coach', 'player')),
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  used_count  integer NOT NULL DEFAULT 0,
  max_uses    integer
);
CREATE INDEX idx_org_invites_code ON org_invites(code);
CREATE INDEX idx_org_invites_org  ON org_invites(org_id);
ALTER TABLE org_invites ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can look up a code (needed to validate before joining)
CREATE POLICY org_invites_select_all ON org_invites
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

-- Only org admin can create
CREATE POLICY org_invites_insert_admin ON org_invites
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
  );

-- Admin can delete
CREATE POLICY org_invites_delete_admin ON org_invites
  FOR DELETE USING (
    org_id IN (SELECT org_id FROM profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
  );
