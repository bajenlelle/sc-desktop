-- =============================================================================
-- Close self-escalation: clients could write the rows their privileges come from
--
-- Found 2026-09-29 while checking what profiles.role still does. Every hole
-- has the same shape: a row the client can write, trusted elsewhere as a grant.
--
-- 1. profiles. profiles_update_own scopes UPDATE to the caller's own row, but
--    `authenticated` held UPDATE on every column and no trigger guards any of
--    them. is_platform_admin() reads profiles.is_platform_admin, so any
--    signed-in user could make themselves platform admin (update_org_license,
--    delete_org_for_platform, om_platform_admin = ALL on org_memberships, …),
--    or set profiles.org_id/role to any club as its admin.
-- 2. team_members_insert_self checked only user_id = auth.uid(). teams_read_all
--    lists every team id, and current_user_team_ids() grants read on every
--    playlist shared to a team, so anyone could join every team in every club.
--    In a rolled-back probe a no-club player went from 2 to 21 readable
--    playlists across 6 owners.
-- 3. organizations_update_own (which trusts profiles.role, see 1) let an org's
--    primary admin rewrite its own licence row directly: expires_at,
--    plan_tier, seat limits. organizations_insert_authenticated let any
--    signed-in user insert an org with any licence. teams_insert_org_admin
--    (profiles.role again) skipped create_team_for_org's licence check.
-- 4. create_org_for_user(text) was executable by anon, guarded only by
--    profiles.org_id IS NULL (true for most users, and for anon), and has no
--    caller.
--
-- No client makes any of these writes directly. Membership, team, invite and
-- org changes all go through SECURITY DEFINER RPCs (join_by_code,
-- assign_member_to_team, create_team_for_org, generate_team_invite,
-- ensure_personal_org, the *_for_platform admin RPCs) or the service role,
-- none of which are affected. The only direct profile writes are the columns
-- granted back below.
--
-- Prod at discovery: 2 platform admins (both staff), and 0 profiles whose
-- role/org_id disagree with org_memberships. No trace of abuse, though a
-- change that was made and then reverted would leave none.
--
-- profiles.role and profiles.org_id stay for now. They are the pre-
-- org_memberships (20260427) "primary org" mirror, still written by the older
-- RPCs; org_memberships.role is the authority, and declared_role is copy only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles: clients may write only their own preferences. Revoking the
--    table-level privilege drops the per-column ones too, so revoke first.
--    A new client-writable profiles column now needs its own GRANT.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON profiles FROM anon, authenticated;
GRANT UPDATE (
  full_name,                          -- updateMyProfile
  avatar_url,                         -- updateMyProfile
  declared_role,                      -- setDeclaredRole (first-run prompt)
  celebrated_plan_tier,               -- markPlanCelebrated
  onboarding_checklist_dismissed_at,  -- dismissOnboardingChecklist
  welcome_dismissed_at,               -- dismissWelcome
  theme_dark,                         -- saveThemePrefs
  theme_light,                        -- saveThemePrefs
  theme_mode                          -- saveThemePrefs
) ON profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Direct writes no client makes, each a way around an RPC's checks. With
--    RLS on and no policy for the command, the write is denied.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS team_members_insert_self ON team_members;
DROP POLICY IF EXISTS organizations_update_own ON organizations;
DROP POLICY IF EXISTS organizations_insert_authenticated ON organizations;
DROP POLICY IF EXISTS teams_insert_org_admin ON teams;

-- ---------------------------------------------------------------------------
-- 3. Unused and open to anon.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_org_for_user(text) FROM PUBLIC, anon, authenticated;
