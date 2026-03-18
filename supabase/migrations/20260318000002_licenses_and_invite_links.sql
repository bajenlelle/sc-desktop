-- =============================================================================
-- 20260318000002: License seats + expiry, shareable invite preview,
--                 org-gated playlist RLS, remove member RPC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add license columns to organizations
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS coach_seat_limit  integer     DEFAULT NULL,  -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS player_seat_limit integer     DEFAULT NULL,  -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS expires_at        timestamptz DEFAULT NULL;  -- NULL = never

-- ---------------------------------------------------------------------------
-- 2. Helper: current_user_org_id() — STABLE SECURITY DEFINER for RLS policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace join_by_code() with license-aware version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_code          text := upper(trim(p_code));
  v_org_invite    org_invites%ROWTYPE;
  v_team_invite   team_invites%ROWTYPE;
  v_org_id        uuid;
  v_cur_org_id    uuid;
  v_org           organizations%ROWTYPE;
  v_coach_count   integer;
  v_player_count  integer;
  v_joining_role  text;
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

    -- Check org license
    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    v_joining_role := v_org_invite.role;
    IF v_joining_role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count FROM profiles
          WHERE org_id = v_org.id AND role IN ('coach', 'admin');
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_joining_role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count FROM profiles
          WHERE org_id = v_org.id AND role = 'player';
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
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

    -- Check org license
    SELECT * INTO v_org FROM organizations WHERE id = v_org_id;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    v_joining_role := v_team_invite.role;
    IF v_joining_role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count FROM profiles
          WHERE org_id = v_org.id AND role IN ('coach', 'admin');
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_joining_role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count FROM profiles
          WHERE org_id = v_org.id AND role = 'player';
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
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
-- 4. get_invite_preview() — accessible by unauthenticated (anon) users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_invite_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code        text := upper(trim(p_code));
  v_org_invite  org_invites%ROWTYPE;
  v_team_invite team_invites%ROWTYPE;
  v_org_name    text;
  v_team_name   text;
  v_org         organizations%ROWTYPE;
BEGIN
  -- Try org_invites
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code;
  IF FOUND THEN
    IF (v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now())
       OR (v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses)
    THEN
      RETURN jsonb_build_object('valid', false);
    END IF;

    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false);
    END IF;

    RETURN jsonb_build_object(
      'valid',      true,
      'org_name',   v_org.name,
      'team_name',  null::text,
      'role',       v_org_invite.role
    );
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code;
  IF FOUND THEN
    IF (v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now())
       OR (v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses)
    THEN
      RETURN jsonb_build_object('valid', false);
    END IF;

    SELECT o.name, t.name INTO v_org_name, v_team_name
      FROM teams t JOIN organizations o ON o.id = t.org_id
      WHERE t.id = v_team_invite.team_id;

    SELECT * INTO v_org FROM organizations
      WHERE id = (SELECT org_id FROM teams WHERE id = v_team_invite.team_id);
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false);
    END IF;

    RETURN jsonb_build_object(
      'valid',      true,
      'org_name',   v_org_name,
      'team_name',  v_team_name,
      'role',       v_team_invite.role
    );
  END IF;

  RETURN jsonb_build_object('valid', false);
END;
$$;

-- Grant execute to anon so unauthenticated users can call it from the join page
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO anon;

-- ---------------------------------------------------------------------------
-- 5. update_org_license() — platform admin only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_org_license(
  p_org_id       uuid,
  p_coach_seats  integer,
  p_player_seats integer,
  p_expires_at   timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  UPDATE organizations
    SET
      coach_seat_limit  = p_coach_seats,
      player_seat_limit = p_player_seats,
      expires_at        = p_expires_at
    WHERE id = p_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. remove_member_from_org() — org admin or platform admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member_from_org(p_user_id uuid)
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
  IF NOT is_platform_admin() THEN
    SELECT org_id INTO v_caller_org FROM profiles WHERE id = v_uid AND role = 'admin';
    IF v_caller_org IS NULL THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
    SELECT org_id INTO v_target_org FROM profiles WHERE id = p_user_id;
    IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
      RAISE EXCEPTION 'user_not_in_org';
    END IF;
  ELSE
    SELECT org_id INTO v_target_org FROM profiles WHERE id = p_user_id;
  END IF;

  -- Delete team memberships within the user's org
  DELETE FROM team_members
    WHERE user_id = p_user_id
      AND team_id IN (
        SELECT t.id FROM teams t WHERE t.org_id = v_target_org
      );

  -- Reset org and role
  UPDATE profiles
    SET org_id = NULL, role = 'coach'
    WHERE id = p_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Org-gated playlist RLS: org members can read any playlist in their org
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playlists' AND policyname = 'playlists_org_read'
  ) THEN
    CREATE POLICY playlists_org_read ON playlists
      FOR SELECT USING (
        current_user_org_id() IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM profiles owner_p
          WHERE owner_p.id = playlists.user_id
            AND owner_p.org_id IS NOT NULL
            AND owner_p.org_id = current_user_org_id()
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playlist_clips' AND policyname = 'playlist_clips_org_read'
  ) THEN
    CREATE POLICY playlist_clips_org_read ON playlist_clips
      FOR SELECT USING (
        playlist_id IN (
          SELECT p.id FROM playlists p
          JOIN profiles owner_p ON owner_p.id = p.user_id
          WHERE owner_p.org_id = current_user_org_id()
            AND owner_p.org_id IS NOT NULL
        )
      );
  END IF;
END;
$$;
