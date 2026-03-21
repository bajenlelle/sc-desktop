-- remove_member_from_team: allows org admins or team coaches to remove a member from a specific team
CREATE OR REPLACE FUNCTION remove_member_from_team(p_user_id uuid, p_team_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_org_id uuid;
  v_team_org_id uuid;
BEGIN
  SELECT org_id INTO v_caller_org_id FROM profiles WHERE id = v_caller_id;

  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_caller_id AND role = 'admin' AND org_id = v_caller_org_id
  ) AND NOT EXISTS (
    SELECT 1 FROM team_members WHERE team_id = p_team_id AND user_id = v_caller_id AND role = 'coach'
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  IF v_team_org_id IS DISTINCT FROM v_caller_org_id THEN
    RAISE EXCEPTION 'team_not_in_org';
  END IF;

  DELETE FROM team_members WHERE team_id = p_team_id AND user_id = p_user_id;
END; $$;

GRANT EXECUTE ON FUNCTION remove_member_from_team(uuid, uuid) TO authenticated;

-- get_org_members_with_email: returns all profiles in the caller's org with email from auth.users
CREATE OR REPLACE FUNCTION get_org_members_with_email()
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, role text,
  org_id uuid, created_at timestamptz, is_platform_admin boolean, email text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT profiles.org_id INTO v_org_id FROM profiles WHERE profiles.id = auth.uid();
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.avatar_url, p.role, p.org_id, p.created_at,
           p.is_platform_admin, u.email::text
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.org_id = v_org_id;
END; $$;

GRANT EXECUTE ON FUNCTION get_org_members_with_email() TO authenticated;
