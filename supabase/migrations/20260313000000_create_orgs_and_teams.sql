CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  logo_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organizations_read_all" ON organizations FOR SELECT USING (true);
-- No write policy: only service-role / dashboard can mutate orgs for now

CREATE TABLE teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sport      text NOT NULL DEFAULT 'basketball',
  season     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams_read_all" ON teams FOR SELECT USING (true);
CREATE INDEX idx_teams_org ON teams (org_id);
