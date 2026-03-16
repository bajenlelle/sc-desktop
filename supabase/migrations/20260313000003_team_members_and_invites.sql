CREATE TABLE team_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'player' CHECK (role IN ('coach', 'player')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Own membership rows
CREATE POLICY team_members_select_own ON team_members
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- All members of teams you belong to (needed for roster display)
CREATE POLICY team_members_select_same_team ON team_members
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = (SELECT auth.uid()))
  );

-- Self-insert (used by join_team_by_code RPC; RPC uses SECURITY DEFINER so this policy is not
-- strictly needed for RPC path, but allows direct inserts if ever needed)
CREATE POLICY team_members_insert_self ON team_members
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

-- -----------------------------------------------------------------------

CREATE TABLE team_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'player' CHECK (role IN ('coach', 'player')),
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,           -- NULL = never expires
  used_count  integer NOT NULL DEFAULT 0,
  max_uses    integer                -- NULL = unlimited
);
CREATE INDEX idx_team_invites_code ON team_invites(code);
CREATE INDEX idx_team_invites_team ON team_invites(team_id);
ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can look up a code (required for join flow)
CREATE POLICY team_invites_select_all ON team_invites
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

-- Only team members can create invites for their team
CREATE POLICY team_invites_insert_member ON team_invites
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = created_by
    AND team_id IN (SELECT team_id FROM team_members WHERE user_id = (SELECT auth.uid()))
  );

-- Creator can delete their own invite
CREATE POLICY team_invites_delete_own ON team_invites
  FOR DELETE USING (created_by = (SELECT auth.uid()));
