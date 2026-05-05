-- Fix remove_member_from_org to always clean up team_members.
--
-- Previously, the DELETE FROM team_members was guarded by
-- "IF v_primary_org = p_org_id" — so removing a user from a secondary/NT org
-- left their team_members rows intact, causing them to appear in team rosters
-- (with no matching profile, the UI would show a raw user_id fragment).
--
-- Fix: move DELETE FROM team_members outside the primary-org guard so it
-- always runs. The UPDATE profiles reset still only applies to primary org.

CREATE OR REPLACE FUNCTION remove_member_from_org(p_user_id uuid, p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_primary_org uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    SELECT role INTO v_caller_role
    FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id) THEN
      RAISE EXCEPTION 'user_not_in_org';
    END IF;
  END IF;

  -- Always remove from team_members in this org (primary or secondary)
  DELETE FROM team_members
    WHERE user_id = p_user_id
      AND team_id IN (SELECT id FROM teams WHERE org_id = p_org_id);

  -- Only detach profiles.org_id when this is the user's primary org
  SELECT org_id INTO v_primary_org FROM profiles WHERE id = p_user_id;
  IF v_primary_org = p_org_id THEN
    UPDATE profiles SET org_id = NULL, role = 'coach' WHERE id = p_user_id;
  END IF;

  DELETE FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_member_from_org(uuid, uuid) TO authenticated;
