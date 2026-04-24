-- =============================================================================
-- National Team Coach Feature
-- Adds is_national_team flag to profiles and org_invites.
-- When a user joins via a national-team invite, the flag is stamped on their profile.
-- =============================================================================

-- 1. Add column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_national_team boolean NOT NULL DEFAULT false;

-- 2. Add column to org_invites
ALTER TABLE org_invites
  ADD COLUMN IF NOT EXISTS is_national_team boolean NOT NULL DEFAULT false;

-- 3. Update generate_org_invite to accept and store the flag
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
  v_code        text;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_uid AND org_id = p_org_id;

  -- Platform admin: can generate any role and national team invites
  -- Org admin: can generate coach/player/admin codes (but NOT national team flag)
  -- Coach: can only generate coach-role codes (no national team flag)
  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role = 'coach')
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Only platform admins can issue national team invites
  IF p_is_national_team AND NOT is_platform_admin() THEN
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
      p_is_national_team
    );

  RETURN v_code;
END;
$$;

-- 4. Update join_by_code to stamp is_national_team onto the joining profile
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
