-- Direct UPDATEs on organizations are gated by a legacy single-org policy
-- (organizations_update_own) that doesn't include platform admins. The web
-- admin page tries to UPDATE plan_tier directly, which silently affects 0
-- rows. Match the existing pattern (update_org_license,
-- update_org_name_for_platform) with a SECURITY DEFINER RPC.

CREATE OR REPLACE FUNCTION update_org_plan_tier_for_platform(
  p_org_id uuid,
  p_tier   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF p_tier NOT IN ('free', 'rookie', 'pro', 'franchise') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;
  UPDATE organizations SET plan_tier = p_tier WHERE id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_plan_tier_for_platform(uuid, text) TO authenticated;
