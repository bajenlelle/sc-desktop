-- Extend get_all_orgs_with_counts to include team_count
DROP FUNCTION IF EXISTS get_all_orgs_with_counts();
CREATE OR REPLACE FUNCTION get_all_orgs_with_counts()
RETURNS TABLE (
  id           uuid,
  name         text,
  logo_url     text,
  created_at   timestamptz,
  member_count bigint,
  team_count   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  RETURN QUERY
    SELECT o.id, o.name, o.logo_url, o.created_at,
           COUNT(DISTINCT p.id)::bigint AS member_count,
           COUNT(DISTINCT t.id)::bigint AS team_count
    FROM organizations o
    LEFT JOIN profiles p ON p.org_id = o.id
    LEFT JOIN teams t ON t.org_id = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at
    ORDER BY o.created_at DESC;
END;
$$;

-- New RPC: update_org_name_for_platform
CREATE OR REPLACE FUNCTION update_org_name_for_platform(p_org_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  UPDATE organizations SET name = p_name WHERE id = p_org_id;
END;
$$;
