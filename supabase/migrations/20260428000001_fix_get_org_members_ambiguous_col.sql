-- Fix: column reference "org_id" is ambiguous in get_org_members.
-- The RETURNS TABLE declares an output column named "org_id", which conflicts
-- with the unqualified "org_id" in the EXISTS auth check. Qualify it explicitly.
CREATE OR REPLACE FUNCTION get_org_members(p_org_id uuid)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, email text,
  role text, org_id uuid, created_at timestamptz, is_platform_admin boolean, joined_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships om_auth
      WHERE om_auth.user_id = (SELECT auth.uid()) AND om_auth.org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'not_in_org';
    END IF;
  END IF;

  RETURN QUERY
    SELECT p.id, p.full_name, p.avatar_url, u.email::text,
           om.role, p.org_id, p.created_at, p.is_platform_admin, om.joined_at
    FROM org_memberships om
    JOIN profiles p ON p.id = om.user_id
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.org_id = p_org_id
    ORDER BY om.joined_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_members(uuid) TO authenticated;
