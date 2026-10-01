-- =============================================================================
-- Scope organizations and teams reads to members (and platform admins)
--
-- Both tables were FOR SELECT USING (true), for every role including anon, so
-- each club's contact name and email, notes and licence fields were readable
-- with the public anon key.
--
-- Nothing needs a wider read. Every direct PostgREST read is the caller's own
-- org: the org-context loaders (getOrgContext / getOrgContextForOrg in web,
-- desktop and shared) take their ids from get_my_orgs or profiles.org_id. The
-- one exception is the platform-admin org page (getOrgById), which the
-- platform-admin branch covers. Every SQL function that reads these tables is
-- SECURITY DEFINER (get_my_orgs, get_invite_preview, join_by_code, the
-- notify functions, the share guards), the landing site and Stripe webhook
-- use the service role, and there are no views over them.
--
-- Prod 2026-10-01, before this migration: 0 team members outside their team's
-- org, 0 share recipients outside the playlist's org, 0 profiles whose org_id
-- has no membership. The new rule hides nothing anyone sees today.
--
-- Members, players included, still read their own club's contact fields and
-- notes; RLS scopes rows, not columns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The orgs the caller belongs to. SECURITY DEFINER so the policies below
--    don't recurse through org_memberships RLS (pattern: current_user_team_ids).
--    Distinct from current_user_org_id(), the legacy single primary org.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_member_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_memberships WHERE user_id = (SELECT auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 2. organizations: members and platform admins.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_read_all ON organizations;
CREATE POLICY organizations_select_member ON organizations FOR SELECT
  USING (id IN (SELECT current_user_member_org_ids()) OR (SELECT is_platform_admin()));

-- ---------------------------------------------------------------------------
-- 3. teams: every team of the caller's orgs (the org page, setup card and
--    share/filter pickers list them all), and platform admins.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS teams_read_all ON teams;
CREATE POLICY teams_select_member ON teams FOR SELECT
  USING (org_id IN (SELECT current_user_member_org_ids()) OR (SELECT is_platform_admin()));
