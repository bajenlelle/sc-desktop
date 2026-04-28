-- =============================================================================
-- Unified org_memberships: replace nt_memberships with a generalized table.
-- Primary org remains in profiles.org_id (denormalized cache).
-- All secondary org memberships (NT or future multi-club) live here.
-- The ONLY differences between org types are:
--   1. Join behavior: NT join doesn't overwrite profiles.org_id
--   2. Billing: NT league imports don't count toward limits (handled by league_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create org_memberships table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_memberships (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'coach',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;

-- Users read their own memberships
CREATE POLICY om_self_read ON org_memberships
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- Org admins read all memberships in their org
CREATE POLICY om_admin_read ON org_memberships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_memberships adm
      WHERE adm.user_id = (SELECT auth.uid())
        AND adm.org_id = org_memberships.org_id
        AND adm.role = 'admin'
    )
  );

-- Platform admins have full access
CREATE POLICY om_platform_admin ON org_memberships
  FOR ALL USING (is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. Backfill from existing data
-- ---------------------------------------------------------------------------

-- Backfill club org members from profiles
INSERT INTO org_memberships (user_id, org_id, role, joined_at)
SELECT id, org_id, role, created_at
FROM profiles
WHERE org_id IS NOT NULL
ON CONFLICT (user_id, org_id) DO NOTHING;

-- Backfill NT members from nt_memberships (upgrade role on conflict)
INSERT INTO org_memberships (user_id, org_id, role, joined_at)
SELECT user_id, nt_org_id, role, joined_at
FROM nt_memberships
ON CONFLICT (user_id, org_id) DO UPDATE SET role =
  CASE WHEN EXCLUDED.role = 'admin' THEN 'admin'
       WHEN org_memberships.role = 'admin' THEN 'admin'
       ELSE EXCLUDED.role END;

-- ---------------------------------------------------------------------------
-- 3. Drop legacy table and column
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS nt_memberships;
ALTER TABLE profiles DROP COLUMN IF EXISTS is_national_team;

-- ---------------------------------------------------------------------------
-- 4. Updated join_by_code: both NT and club paths upsert org_memberships.
--    Club path also updates profiles.org_id. NT path leaves it unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_code        text := upper(trim(p_code));
  v_org_invite  org_invites%ROWTYPE;
  v_team_invite team_invites%ROWTYPE;
  v_org_id      uuid;
  v_cur_org_id  uuid;
  v_is_nt_org   boolean;
  v_new_role    text;
BEGIN
  -- Try org_invites first
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    SELECT COALESCE(o.is_nt_org, false) INTO v_is_nt_org
    FROM organizations o WHERE o.id = v_org_invite.org_id;

    IF v_is_nt_org THEN
      -- NT ORG PATH: additive, don't touch profiles.org_id
      INSERT INTO org_memberships (user_id, org_id, role)
        VALUES (v_uid, v_org_invite.org_id, v_org_invite.role)
        ON CONFLICT (user_id, org_id) DO UPDATE SET role =
          CASE WHEN v_org_invite.role = 'admin' THEN 'admin'
               WHEN org_memberships.role = 'admin' THEN 'admin'
               ELSE v_org_invite.role END;

      UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
      RETURN jsonb_build_object('type', 'nt_org', 'org_id', v_org_invite.org_id);
    ELSE
      -- CLUB ORG PATH: check not already in a different org
      SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
      IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_org_invite.org_id THEN
        RAISE EXCEPTION 'already_in_different_org';
      END IF;

      -- Determine new role (keep highest privilege)
      SELECT CASE
        WHEN v_org_invite.role = 'admin' THEN 'admin'
        WHEN COALESCE(p.role, 'coach') = 'admin' THEN 'admin'
        ELSE v_org_invite.role
      END INTO v_new_role
      FROM profiles p WHERE p.id = v_uid;

      -- Update primary org in profiles
      UPDATE profiles
        SET org_id = v_org_invite.org_id,
            role   = v_new_role
        WHERE id = v_uid;

      -- Upsert into org_memberships (keep in sync with profiles)
      INSERT INTO org_memberships (user_id, org_id, role)
        VALUES (v_uid, v_org_invite.org_id, v_new_role)
        ON CONFLICT (user_id, org_id) DO UPDATE SET role =
          CASE WHEN v_new_role = 'admin' THEN 'admin'
               WHEN org_memberships.role = 'admin' THEN 'admin'
               ELSE v_new_role END;

      UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
      RETURN jsonb_build_object('type', 'org', 'org_id', v_org_invite.org_id);
    END IF;
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    SELECT t.org_id INTO v_org_id FROM teams t WHERE t.id = v_team_invite.team_id;

    SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
    IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_org_id THEN
      RAISE EXCEPTION 'already_in_different_org';
    END IF;

    SELECT CASE WHEN COALESCE(p.role, 'coach') = 'admin' THEN 'admin' ELSE v_team_invite.role END
    INTO v_new_role FROM profiles p WHERE p.id = v_uid;

    UPDATE profiles
      SET org_id = COALESCE(org_id, v_org_id),
          role   = v_new_role
      WHERE id = v_uid;

    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org_id, v_new_role)
      ON CONFLICT (user_id, org_id) DO NOTHING;

    INSERT INTO team_members (team_id, user_id, role)
      VALUES (v_team_invite.team_id, v_uid, v_team_invite.role)
      ON CONFLICT (team_id, user_id) DO NOTHING;

    UPDATE team_invites SET used_count = used_count + 1 WHERE id = v_team_invite.id;
    RETURN jsonb_build_object('type', 'team', 'org_id', v_org_id, 'team_id', v_team_invite.team_id);
  END IF;

  RAISE EXCEPTION 'invalid_code';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Updated generate_org_invite: unified auth check via org_memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_org_invite(
  p_org_id           uuid,
  p_role             text    DEFAULT 'coach',
  p_max_uses         integer DEFAULT NULL,
  p_expires_in_hours integer DEFAULT NULL,
  p_is_national_team boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_is_nt_org   boolean;
  v_code        text;
BEGIN
  SELECT COALESCE(o.is_nt_org, false) INTO v_is_nt_org
  FROM organizations o WHERE o.id = p_org_id;

  -- Unified auth: check org_memberships for this org
  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role = 'coach')
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
  END LOOP;

  INSERT INTO org_invites (org_id, code, role, created_by, expires_at, max_uses, is_national_team)
    VALUES (
      p_org_id, v_code, p_role, v_uid,
      CASE WHEN p_expires_in_hours IS NOT NULL
           THEN now() + (p_expires_in_hours || ' hours')::interval
           ELSE NULL END,
      p_max_uses,
      CASE WHEN v_is_nt_org THEN true ELSE p_is_national_team END
    );

  RETURN v_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. New: get_my_secondary_orgs() — orgs the user belongs to beyond their primary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_secondary_orgs()
RETURNS TABLE (org_id uuid, org_name text, role text, is_nt_org boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id, o.name, om.role, COALESCE(o.is_nt_org, false)
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = (SELECT auth.uid())
    AND om.org_id IS DISTINCT FROM (
      SELECT p.org_id FROM profiles p WHERE p.id = (SELECT auth.uid())
    );
$$;

GRANT EXECUTE ON FUNCTION get_my_secondary_orgs() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. New: get_org_members(p_org_id) — generic member fetch for any org type.
--    Replaces get_org_members_with_email (primary org only) and
--    get_nt_org_members (NT orgs only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_org_members(p_org_id uuid)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, email text,
  role text, org_id uuid, created_at timestamptz, is_platform_admin boolean, joined_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = (SELECT auth.uid()) AND org_id = p_org_id
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

-- Update get_org_members_with_email to delegate to get_org_members (backward compat)
CREATE OR REPLACE FUNCTION get_org_members_with_email()
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, role text,
  org_id uuid, created_at timestamptz, is_platform_admin boolean, email text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT profiles.org_id INTO v_org_id FROM profiles WHERE profiles.id = auth.uid();
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT gom.id, gom.full_name, gom.avatar_url, gom.role,
           gom.org_id, gom.created_at, gom.is_platform_admin, gom.email
    FROM get_org_members(v_org_id) gom;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Unified remove_member_from_org(p_user_id, p_org_id)
--    Replaces old single-param version.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS remove_member_from_org(uuid);

CREATE OR REPLACE FUNCTION remove_member_from_org(p_user_id uuid, p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_primary_org uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    SELECT role INTO v_caller_role
    FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id) THEN
      RAISE EXCEPTION 'user_not_in_org';
    END IF;
  END IF;

  -- If this is the user's primary org: detach from profiles + clean up team memberships
  SELECT org_id INTO v_primary_org FROM profiles WHERE id = p_user_id;
  IF v_primary_org = p_org_id THEN
    DELETE FROM team_members
      WHERE user_id = p_user_id
        AND team_id IN (SELECT id FROM teams WHERE org_id = p_org_id);
    UPDATE profiles SET org_id = NULL, role = 'coach' WHERE id = p_user_id;
  END IF;

  DELETE FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_member_from_org(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Updated create_team_for_org: accepts optional p_org_id for multi-org users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_team_for_org(
  team_name   text,
  team_season text DEFAULT NULL,
  p_org_id    uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org_id  uuid;
  v_team_id uuid;
BEGIN
  IF p_org_id IS NOT NULL THEN
    IF NOT is_platform_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM org_memberships
        WHERE user_id = v_uid AND org_id = p_org_id AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'not_admin';
      END IF;
    END IF;
    v_org_id := p_org_id;
  ELSE
    -- Backward compat: derive from profiles.org_id
    SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid AND role = 'admin';
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  INSERT INTO teams (org_id, name, season)
    VALUES (v_org_id, team_name, team_season)
    RETURNING id INTO v_team_id;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_team_id, v_uid, 'coach');

  RETURN v_team_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Updated assign_member_to_team: auth + membership via org_memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_member_to_team(
  p_user_id uuid,
  p_team_id uuid,
  p_role    text DEFAULT 'player'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_team_org uuid;
BEGIN
  SELECT org_id INTO v_team_org FROM teams WHERE id = p_team_id;
  IF v_team_org IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_uid AND org_id = v_team_org AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = v_team_org
  ) THEN
    RAISE EXCEPTION 'user_or_team_not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, p_user_id, p_role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = p_role;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Updated join_org_team: membership check via org_memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_org_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_team_org uuid;
BEGIN
  SELECT org_id INTO v_team_org FROM teams WHERE id = p_team_id;
  IF v_team_org IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_team_org
  ) THEN
    RAISE EXCEPTION 'not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, v_uid, 'coach')
    ON CONFLICT (team_id, user_id) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Updated promote_to_admin: optional p_org_id, updates org_memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promote_to_admin(p_user_id uuid, p_org_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF p_org_id IS NOT NULL THEN
    v_org_id := p_org_id;
  ELSE
    SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid;
  END IF;

  IF v_org_id IS NULL THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_uid AND org_id = v_org_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'user_not_in_org';
  END IF;

  UPDATE org_memberships SET role = 'admin'
    WHERE user_id = p_user_id AND org_id = v_org_id;

  -- Keep profiles.role in sync for primary org
  UPDATE profiles SET role = 'admin'
    WHERE id = p_user_id AND org_id = v_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. Updated remove_member_from_team: auth check via org_memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member_from_team(p_user_id uuid, p_team_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_team_org  uuid;
BEGIN
  SELECT org_id INTO v_team_org FROM teams WHERE id = p_team_id;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_caller_id AND org_id = v_team_org AND role = 'admin'
    ) AND NOT EXISTS (
      SELECT 1 FROM team_members
      WHERE team_id = p_team_id AND user_id = v_caller_id AND role = 'coach'
    ) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  DELETE FROM team_members WHERE team_id = p_team_id AND user_id = p_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. Updated get_all_orgs_with_counts: member count from org_memberships
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_all_orgs_with_counts();
CREATE OR REPLACE FUNCTION get_all_orgs_with_counts()
RETURNS TABLE (
  id uuid, name text, logo_url text, created_at timestamptz,
  member_count bigint, team_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.logo_url, o.created_at,
           COUNT(DISTINCT om.user_id)::bigint,
           COUNT(DISTINCT t.id)::bigint
    FROM organizations o
    LEFT JOIN org_memberships om ON om.org_id = o.id
    LEFT JOIN teams t ON t.org_id = o.id
    GROUP BY o.id, o.name, o.logo_url, o.created_at
    ORDER BY o.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 15. New: check_onboarding_needed() — single RPC for proxy guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_onboarding_needed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    NOT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), false)
    AND NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION check_onboarding_needed() TO authenticated;
