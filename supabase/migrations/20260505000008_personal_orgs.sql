-- Add is_personal flag to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

-- Update get_my_orgs() to return is_personal
DROP FUNCTION IF EXISTS get_my_orgs();
CREATE FUNCTION get_my_orgs()
RETURNS TABLE (org_id uuid, org_name text, role text, is_nt_org boolean, plan_tier text, is_personal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id, o.name, om.role, COALESCE(o.is_nt_org, false), o.plan_tier, o.is_personal
  FROM org_memberships om JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = (SELECT auth.uid());
$$;

-- Backfill: create personal orgs for existing users with no org memberships
DO $$
DECLARE v_user RECORD; v_org_id uuid;
BEGIN
  FOR v_user IN
    SELECT p.id, p.full_name
    FROM profiles p
    WHERE NOT EXISTS (SELECT 1 FROM org_memberships om WHERE om.user_id = p.id)
  LOOP
    INSERT INTO organizations (name, is_personal)
    VALUES (COALESCE(NULLIF(TRIM(v_user.full_name), ''), 'Personal'), true)
    RETURNING id INTO v_org_id;
    INSERT INTO org_memberships (org_id, user_id, role)
    VALUES (v_org_id, v_user.id, 'admin');
  END LOOP;
END;
$$;

-- Update handle_new_user trigger to auto-create personal org at signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations (name, is_personal)
  VALUES (COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), 'Personal'), true)
  RETURNING id INTO v_org_id;

  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (v_org_id, NEW.id, 'admin');

  RETURN NEW;
END;
$$;
