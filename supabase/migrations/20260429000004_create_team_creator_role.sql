-- =============================================================================
-- 20260429000004: Fix create_team_for_org always adding creator as 'coach'
--
-- The creator is inserted into team_members with their actual org role
-- (admin/coach) instead of the hardcoded 'coach'.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_team_for_org(
  team_name   text,
  team_season text DEFAULT NULL,
  p_org_id    uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_org_id     uuid;
  v_team_id    uuid;
  v_creator_role text;
BEGIN
  IF p_org_id IS NOT NULL THEN
    IF NOT is_platform_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM org_memberships
        WHERE user_id = v_uid AND org_id = p_org_id AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'not_admin';
      END IF;
    END IF;
    v_org_id := p_org_id;
  ELSE
    -- Backward compat: derive from profiles.org_id
    SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid AND role = 'admin';
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  -- Use the creator's org role, clamped to coach/player (team_members doesn't allow 'admin')
  SELECT CASE WHEN COALESCE(role, 'coach') = 'player' THEN 'player' ELSE 'coach' END
  INTO v_creator_role
  FROM org_memberships
  WHERE user_id = v_uid AND org_id = v_org_id;

  INSERT INTO teams (org_id, name, season)
    VALUES (v_org_id, team_name, team_season)
    RETURNING id INTO v_team_id;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_team_id, v_uid, v_creator_role);

  RETURN v_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_team_for_org(text, text, uuid) TO authenticated;
