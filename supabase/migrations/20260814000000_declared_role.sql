-- =============================================================================
-- Capture coach/player intent at signup.
--
-- declared_role is a copy/analytics signal, never a permission — membership
-- roles stay authoritative and profiles.role stays untouched. NULL = never
-- captured (triggers the one-click first-run prompt for OAuth signups).
-- =============================================================================

ALTER TABLE profiles
  ADD COLUMN declared_role text CHECK (declared_role IN ('coach', 'player'));

-- 1. Signup form path: the client sends declared_role in the auth metadata.
--    Guarded so unexpected metadata can never violate the CHECK and abort
--    account creation.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, declared_role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN NEW.raw_user_meta_data->>'declared_role' IN ('coach', 'player')
         THEN NEW.raw_user_meta_data->>'declared_role' END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations (name, is_personal)
  VALUES (COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), 'Personal'), true)
  RETURNING id INTO v_org_id;

  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (v_org_id, NEW.id, 'admin');

  RETURN NEW;
END;
$$;

-- 2. Invite path: joining a CLUB org tells us the role — don't ask again.
--    The is_personal guard is load-bearing: signup's own personal-org
--    membership ('admin') must NOT stamp everyone as coach, or the OAuth
--    fallback prompt would never show.
CREATE FUNCTION infer_declared_role_from_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.org_id AND NOT o.is_personal) THEN
    UPDATE profiles
    SET declared_role = CASE WHEN NEW.role = 'player' THEN 'player' ELSE 'coach' END
    WHERE id = NEW.user_id AND declared_role IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_memberships_infer_declared_role
  AFTER INSERT ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION infer_declared_role_from_membership();

-- 3. Backfill existing accounts so nobody who's already onboard gets asked:
--    club members from their membership role, personal-only users as coach
--    (the current beta cohort is coaches).
UPDATE profiles p
SET declared_role = sub.role
FROM (
  SELECT om.user_id,
         CASE WHEN bool_or(om.role = 'player') AND NOT bool_or(om.role IN ('coach', 'admin'))
              THEN 'player' ELSE 'coach' END AS role
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE NOT o.is_personal
  GROUP BY om.user_id
) sub
WHERE p.id = sub.user_id AND p.declared_role IS NULL;

UPDATE profiles SET declared_role = 'coach' WHERE declared_role IS NULL;
