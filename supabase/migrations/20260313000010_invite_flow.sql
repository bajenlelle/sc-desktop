-- =============================================================================
-- Phase A: Invite Flow & Role-Based Access DB Changes
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. join_by_code: auto-detects org vs team invite code, handles join atomically.
--    Returns jsonb: { "type": "org"|"team", "org_id": uuid, "team_id"?: uuid }
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

    SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
    IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_org_invite.org_id THEN
      RAISE EXCEPTION 'already_in_different_org';
    END IF;

    UPDATE profiles
      SET
        org_id = v_org_invite.org_id,
        role   = CASE
                   WHEN v_org_invite.role = 'admin' THEN 'admin'
                   WHEN role = 'admin'              THEN 'admin'
                   ELSE v_org_invite.role
                 END
      WHERE id = v_uid;

    UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
    RETURN jsonb_build_object('type', 'org', 'org_id', v_org_invite.org_id);
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

-- ---------------------------------------------------------------------------
-- 2. promote_to_admin: org admin promotes a coach to admin in the same org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promote_to_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_caller_org uuid;
  v_target_org uuid;
BEGIN
  SELECT org_id INTO v_caller_org FROM profiles WHERE id = v_uid AND role = 'admin';
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT org_id INTO v_target_org FROM profiles WHERE id = p_user_id;
  IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
    RAISE EXCEPTION 'user_not_in_org';
  END IF;

  UPDATE profiles SET role = 'admin' WHERE id = p_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Playlists RLS: team members can SELECT playlists assigned to their team
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playlists' AND policyname = 'playlists_select_team_member'
  ) THEN
    CREATE POLICY playlists_select_team_member ON playlists
      FOR SELECT USING (
        team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = playlists.team_id
            AND tm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. generate_org_invite: allow coaches to generate coach-role org invites
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_org_invite(
  p_org_id           uuid,
  p_role             text    DEFAULT 'coach',
  p_max_uses         integer DEFAULT NULL,
  p_expires_in_hours integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_code        text;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_uid AND org_id = p_org_id;

  -- Platform admin: can generate any role
  -- Org admin: can generate coach/player/admin codes for their org
  -- Coach: can only generate coach-role codes for their org
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

-- ---------------------------------------------------------------------------
-- 5. Update org_invites INSERT policy so coaches can also insert coach codes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_invites_insert_admin ON org_invites;

CREATE POLICY org_invites_insert_admin ON org_invites
  FOR INSERT WITH CHECK (
    is_platform_admin()
    OR org_id IN (
      SELECT org_id FROM profiles
      WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'coach')
    )
  );
