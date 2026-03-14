-- 1a. New column
ALTER TABLE profiles
  ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

-- 1b. is_platform_admin() SECURITY DEFINER helper
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- 1c. Update profiles_select_own_or_same_org policy
DROP POLICY IF EXISTS profiles_select_own_or_same_org ON profiles;

CREATE POLICY profiles_select_own_or_same_org ON profiles
  FOR SELECT USING (
    id = (SELECT auth.uid())
    OR (org_id IS NOT NULL AND org_id = current_user_org_id())
    OR is_platform_admin()
  );

-- 1d. Extend org_invites role CHECK constraint to include 'admin'
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'org_invites'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE org_invites DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE org_invites
  ADD CONSTRAINT org_invites_role_check
  CHECK (role IN ('coach', 'player', 'admin'));

-- 1e. Update org_invites RLS policies
DROP POLICY IF EXISTS org_invites_insert_admin ON org_invites;
DROP POLICY IF EXISTS org_invites_delete_admin ON org_invites;

CREATE POLICY org_invites_insert_admin ON org_invites
  FOR INSERT WITH CHECK (
    is_platform_admin()
    OR org_id IN (
      SELECT org_id FROM profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY org_invites_delete_admin ON org_invites
  FOR DELETE USING (
    is_platform_admin()
    OR org_id IN (
      SELECT org_id FROM profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- 1f. New RPC: create_org_for_platform
CREATE OR REPLACE FUNCTION create_org_for_platform(org_name text)
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
  INSERT INTO organizations (name) VALUES (org_name) RETURNING id INTO v_org_id;
  RETURN v_org_id;
END;
$$;

-- 1g. UPDATE RPC: generate_org_invite
CREATE OR REPLACE FUNCTION generate_org_invite(
  p_org_id           uuid,
  p_role             text    DEFAULT 'player',
  p_max_uses         integer DEFAULT NULL,
  p_expires_in_hours integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
BEGIN
  IF NOT (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = v_uid AND org_id = p_org_id AND role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
  END LOOP;

  INSERT INTO org_invites (org_id, code, role, created_by, expires_at, max_uses)
    VALUES (
      p_org_id, v_code, p_role, v_uid,
      CASE WHEN p_expires_in_hours IS NOT NULL
           THEN now() + (p_expires_in_hours || ' hours')::interval
           ELSE NULL END,
      p_max_uses
    );

  RETURN v_code;
END;
$$;

-- 1h. UPDATE RPC: join_org_by_code
CREATE OR REPLACE FUNCTION join_org_by_code(invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_invite     org_invites%ROWTYPE;
  v_cur_org_id uuid;
BEGIN
  SELECT * INTO v_invite FROM org_invites WHERE code = invite_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'code_expired';
  END IF;
  IF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
  IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_invite.org_id THEN
    RAISE EXCEPTION 'already_in_different_org';
  END IF;

  UPDATE profiles
    SET
      org_id = v_invite.org_id,
      role   = CASE
                 WHEN v_invite.role = 'admin' THEN 'admin'
                 WHEN role = 'admin'          THEN 'admin'
                 ELSE v_invite.role
               END
    WHERE id = v_uid;

  UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_invite.id;
  RETURN v_invite.org_id;
END;
$$;

-- 1i. New RPC: get_all_orgs_with_counts
CREATE OR REPLACE FUNCTION get_all_orgs_with_counts()
RETURNS TABLE (
  id           uuid,
  name         text,
  logo_url     text,
  created_at   timestamptz,
  member_count bigint
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
           COUNT(p.id)::bigint
    FROM organizations o
    LEFT JOIN profiles p ON p.org_id = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at
    ORDER BY o.created_at DESC;
END;
$$;
