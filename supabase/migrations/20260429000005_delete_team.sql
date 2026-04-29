-- =============================================================================
-- 20260429000005: Add delete_team RPC
--
-- Allows org admins to delete a team they manage.
-- Cascades: team_members and team_invites are deleted via FK ON DELETE CASCADE.
-- org_invites with team_id SET NULL via FK ON DELETE SET NULL.
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM teams WHERE id = p_team_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found';
  END IF;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_uid AND org_id = v_org_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  DELETE FROM teams WHERE id = p_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_team(uuid) TO authenticated;
