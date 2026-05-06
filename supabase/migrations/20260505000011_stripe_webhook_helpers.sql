-- Helpers for the Stripe webhook to look up users by email and to set the
-- plan_tier on a user's personal org without exposing direct UPDATE access.

CREATE OR REPLACE FUNCTION get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM auth.users WHERE email = p_email LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_user_id_by_email(text) TO service_role;

CREATE OR REPLACE FUNCTION set_personal_org_plan_tier(p_user_id uuid, p_tier text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_tier NOT IN ('free', 'rookie', 'pro') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;
  UPDATE organizations
  SET plan_tier = p_tier
  WHERE id IN (
    SELECT om.org_id FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = p_user_id AND o.is_personal = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION set_personal_org_plan_tier(uuid, text) TO service_role;
