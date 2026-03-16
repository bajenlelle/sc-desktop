-- Fix join_org_team() to use the caller's org role instead of hardcoding 'player'
CREATE OR REPLACE FUNCTION join_org_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
  v_role   text;
BEGIN
  SELECT org_id, role INTO v_org_id, v_role FROM profiles WHERE id = v_uid;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_in_org';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'team_not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, v_uid, v_role)
    ON CONFLICT (team_id, user_id) DO NOTHING;
END;
$$;
