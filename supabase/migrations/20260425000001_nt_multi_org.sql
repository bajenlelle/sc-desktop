-- =============================================================================
-- National Team Multi-Org Membership
-- Allows coaches to belong to both a club org (profiles.org_id) and an NT org
-- (nt_memberships table) simultaneously. Adds league_id to matches for
-- separate billing of NT vs club imports.
-- =============================================================================

-- 1. Mark certain orgs as national team orgs
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_nt_org boolean NOT NULL DEFAULT false;

-- 2. Create nt_memberships table (secondary membership for NT orgs)
CREATE TABLE IF NOT EXISTS nt_memberships (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nt_org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'coach',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, nt_org_id)
);

ALTER TABLE nt_memberships ENABLE ROW LEVEL SECURITY;

-- Users can read their own NT memberships
CREATE POLICY nt_memberships_self_read ON nt_memberships
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- NT org admins can read all memberships in their org
CREATE POLICY nt_memberships_admin_read ON nt_memberships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM nt_memberships adm
      WHERE adm.user_id = (SELECT auth.uid())
        AND adm.nt_org_id = nt_memberships.nt_org_id
        AND adm.role = 'admin'
    )
  );

-- Platform admins have full access
CREATE POLICY nt_memberships_platform_admin ON nt_memberships
  FOR ALL USING (is_platform_admin());

-- 3. Add league_id to matches (nullable for backward compat)
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS league_id text;

CREATE INDEX IF NOT EXISTS idx_matches_user_league_created
  ON matches (user_id, league_id, created_at);

-- 4. RPC: count club matches this month (excludes NT league imports)
CREATE OR REPLACE FUNCTION count_club_matches_this_month(p_nt_league_ids text[] DEFAULT '{}')
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM matches
  WHERE user_id = auth.uid()
    AND created_at >= date_trunc('month', now())
    AND (league_id IS NULL OR NOT (league_id = ANY(p_nt_league_ids)));
$$;

-- 5. RPC: get my NT memberships
CREATE OR REPLACE FUNCTION get_my_nt_memberships()
RETURNS TABLE (nt_org_id uuid, nt_org_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.nt_org_id, o.name, m.role
  FROM nt_memberships m
  JOIN organizations o ON o.id = m.nt_org_id
  WHERE m.user_id = auth.uid();
$$;

-- 6. RPC: get NT org members (for federation admin)
CREATE OR REPLACE FUNCTION get_nt_org_members(p_nt_org_id uuid)
RETURNS TABLE (user_id uuid, full_name text, avatar_url text, role text, joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM nt_memberships
      WHERE nt_memberships.user_id = auth.uid()
        AND nt_org_id = p_nt_org_id
        AND nt_memberships.role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;
  RETURN QUERY
    SELECT m.user_id, p.full_name, p.avatar_url, m.role, m.joined_at
    FROM nt_memberships m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.nt_org_id = p_nt_org_id
    ORDER BY m.joined_at;
END;
$$;

-- 7. RPC: remove NT member
CREATE OR REPLACE FUNCTION remove_nt_member(p_user_id uuid, p_nt_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM nt_memberships
      WHERE user_id = auth.uid() AND nt_org_id = p_nt_org_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  DELETE FROM nt_memberships WHERE user_id = p_user_id AND nt_org_id = p_nt_org_id;

  -- Clear legacy flag if no remaining NT memberships
  IF NOT EXISTS (SELECT 1 FROM nt_memberships WHERE user_id = p_user_id) THEN
    UPDATE profiles SET is_national_team = false WHERE id = p_user_id;
  END IF;
END;
$$;

-- 8. Update join_by_code — NT org path inserts into nt_memberships
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

    -- Check if this is an NT org
    SELECT COALESCE(o.is_nt_org, false) INTO v_is_nt_org
    FROM organizations o WHERE o.id = v_org_invite.org_id;

    IF v_is_nt_org THEN
      -- NT ORG PATH: insert into nt_memberships, don't touch profiles.org_id
      INSERT INTO nt_memberships (user_id, nt_org_id, role)
        VALUES (v_uid, v_org_invite.org_id, v_org_invite.role)
        ON CONFLICT (user_id, nt_org_id) DO UPDATE SET role =
          CASE WHEN v_org_invite.role = 'admin' THEN 'admin'
               WHEN nt_memberships.role = 'admin' THEN 'admin'
               ELSE v_org_invite.role END;

      -- Legacy compat: keep is_national_team flag in sync
      UPDATE profiles SET is_national_team = true WHERE id = v_uid;

      UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
      RETURN jsonb_build_object('type', 'nt_org', 'org_id', v_org_invite.org_id);
    ELSE
      -- CLUB ORG PATH: existing logic
      SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
      IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_org_invite.org_id THEN
        RAISE EXCEPTION 'already_in_different_org';
      END IF;

      UPDATE profiles
        SET
          org_id            = v_org_invite.org_id,
          is_national_team  = v_org_invite.is_national_team,
          role              = CASE
                                WHEN v_org_invite.role = 'admin' THEN 'admin'
                                WHEN role = 'admin'              THEN 'admin'
                                ELSE v_org_invite.role
                              END
        WHERE id = v_uid;

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

    -- Atomically join org + join team
    UPDATE profiles
      SET
        org_id = COALESCE(org_id, v_org_id),
        role   = CASE WHEN role = 'admin' THEN role ELSE v_team_invite.role END
      WHERE id = v_uid;

    INSERT INTO team_members (team_id, user_id, role)
      VALUES (v_team_invite.team_id, v_uid, v_team_invite.role)
      ON CONFLICT (team_id, user_id) DO NOTHING;

    UPDATE team_invites SET used_count = used_count + 1 WHERE id = v_team_invite.id;
    RETURN jsonb_build_object('type', 'team', 'org_id', v_org_id, 'team_id', v_team_invite.team_id);
  END IF;

  RAISE EXCEPTION 'invalid_code';
END;
$$;

-- 9. Update generate_org_invite — allow federation admin (NT org admin)
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
  -- Check if this is an NT org
  SELECT COALESCE(o.is_nt_org, false) INTO v_is_nt_org
  FROM organizations o WHERE o.id = p_org_id;

  -- Try to find caller's role: first check profiles (club org), then nt_memberships
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_uid AND org_id = p_org_id;
  IF v_caller_role IS NULL AND v_is_nt_org THEN
    SELECT m.role INTO v_caller_role FROM nt_memberships m
    WHERE m.user_id = v_uid AND m.nt_org_id = p_org_id;
  END IF;

  -- Authorization check
  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role = 'coach')
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- For NT orgs: platform admins or NT org admins can generate invites
  -- For regular orgs: the is_national_team flag on the invite requires platform admin
  IF NOT v_is_nt_org AND p_is_national_team AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
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

-- 10. Migrate existing data
-- Mark existing NT org(s)
UPDATE organizations SET is_nt_org = true
WHERE id IN (
  SELECT DISTINCT org_id FROM profiles
  WHERE is_national_team = true AND org_id IS NOT NULL
);

-- Backfill nt_memberships from existing flagged profiles
INSERT INTO nt_memberships (user_id, nt_org_id, role)
SELECT p.id, p.org_id, p.role FROM profiles p
WHERE p.is_national_team = true AND p.org_id IS NOT NULL
ON CONFLICT DO NOTHING;
