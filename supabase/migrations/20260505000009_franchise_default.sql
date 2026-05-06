-- Backfill: all existing non-personal orgs get franchise tier
UPDATE organizations
SET plan_tier = 'franchise'
WHERE is_personal = false;

-- create_org_for_platform: always creates a non-personal (franchise) org
CREATE OR REPLACE FUNCTION create_org_for_platform(
  org_name    text,
  p_is_nt_org boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id uuid;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  INSERT INTO organizations (name, is_nt_org, plan_tier)
    VALUES (org_name, p_is_nt_org, 'franchise')
    RETURNING id INTO v_org_id;
  RETURN v_org_id;
END;
$$;

-- create_org_for_user: legacy function, non-personal org → franchise
CREATE OR REPLACE FUNCTION create_org_for_user(org_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND org_id IS NOT NULL) THEN
    RAISE EXCEPTION 'already_in_org';
  END IF;
  INSERT INTO organizations (name, plan_tier) VALUES (org_name, 'franchise') RETURNING id INTO v_org_id;
  UPDATE profiles SET org_id = v_org_id, role = 'admin' WHERE id = v_uid;
  RETURN v_org_id;
END;
$$;
