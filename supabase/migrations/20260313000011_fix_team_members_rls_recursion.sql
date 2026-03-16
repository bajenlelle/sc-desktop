-- Fix: team_members_select_same_team contained a self-referential subquery
-- (`SELECT team_id FROM team_members WHERE user_id = auth.uid()`) which causes
-- infinite recursion when any policy on another table queries team_members.
-- Replace with a SECURITY DEFINER helper that bypasses RLS.

CREATE OR REPLACE FUNCTION current_user_team_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id FROM team_members WHERE user_id = auth.uid();
$$;

DROP POLICY IF EXISTS team_members_select_same_team ON team_members;

CREATE POLICY team_members_select_same_team ON team_members
  FOR SELECT USING (
    team_id IN (SELECT current_user_team_ids())
  );
