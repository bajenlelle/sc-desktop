-- =============================================================================
-- Admin org operations: NT flag on creation, org deletion
-- =============================================================================

-- Extend create_org_for_platform to accept is_nt_org flag
CREATE OR REPLACE FUNCTION create_org_for_platform(
  org_name   text,
  p_is_nt_org boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  INSERT INTO organizations (name, is_nt_org)
    VALUES (org_name, p_is_nt_org)
    RETURNING id INTO v_org_id;
  RETURN v_org_id;
END;
$$;

-- Delete an org (platform admin only)
-- profiles.org_id has ON DELETE SET NULL → members are detached, not deleted
-- nt_memberships.nt_org_id has ON DELETE CASCADE → NT memberships removed
-- org_invites, teams, team_members all have ON DELETE CASCADE
CREATE OR REPLACE FUNCTION delete_org_for_platform(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  DELETE FROM organizations WHERE id = p_org_id;
END;
$$;
