-- auth.users.email is varchar; cast to text so the RETURN TABLE signature
-- matches the projection.

DROP FUNCTION IF EXISTS get_all_orgs_with_counts();

CREATE OR REPLACE FUNCTION get_all_orgs_with_counts()
RETURNS TABLE (
  id           uuid,
  name         text,
  logo_url     text,
  created_at   timestamptz,
  member_count bigint,
  team_count   bigint,
  plan_tier    text,
  is_personal  boolean,
  owner_email  text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  RETURN QUERY
    SELECT
      o.id,
      o.name,
      o.logo_url,
      o.created_at,
      COUNT(DISTINCT om.user_id)::bigint AS member_count,
      COUNT(DISTINCT t.id)::bigint       AS team_count,
      o.plan_tier,
      COALESCE(o.is_personal, false)     AS is_personal,
      CASE
        WHEN COALESCE(o.is_personal, false) THEN (
          SELECT u.email::text
          FROM org_memberships om2
          JOIN auth.users u ON u.id = om2.user_id
          WHERE om2.org_id = o.id AND om2.role = 'admin'
          ORDER BY om2.joined_at ASC
          LIMIT 1
        )
        ELSE NULL
      END                                AS owner_email
    FROM organizations o
    LEFT JOIN org_memberships om ON om.org_id = o.id
    LEFT JOIN teams t            ON t.org_id  = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at, o.plan_tier, o.is_personal
    ORDER BY o.created_at DESC;
END;
$$;
