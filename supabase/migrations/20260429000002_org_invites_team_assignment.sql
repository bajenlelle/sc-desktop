-- =============================================================================
-- 20260429000002: Optional team assignment on org invites
--
-- Changes:
--   1. Add optional team_id column to org_invites
--   2. Update generate_org_invite to accept p_team_id
--   3. Update send_org_invite_emails to accept p_team_id
--   4. Update join_by_code to assign team membership when org_invite has team_id
-- =============================================================================

-- 1. Add team_id column (nullable — only set when invite targets a specific team)
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

-- 2. Update generate_org_invite to accept optional p_team_id
CREATE OR REPLACE FUNCTION generate_org_invite(
  p_org_id           uuid,
  p_role             text    DEFAULT 'coach',
  p_max_uses         integer DEFAULT NULL,
  p_expires_in_hours integer DEFAULT NULL,
  p_is_national_team boolean DEFAULT false,
  p_team_id          uuid    DEFAULT NULL
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

  INSERT INTO org_invites (org_id, code, role, created_by, expires_at, max_uses, is_national_team, team_id)
    VALUES (
      p_org_id, v_code, p_role, v_uid,
      CASE WHEN p_expires_in_hours IS NOT NULL
           THEN now() + (p_expires_in_hours || ' hours')::interval
           ELSE NULL END,
      p_max_uses,
      CASE WHEN v_is_nt_org THEN true ELSE p_is_national_team END,
      p_team_id
    );

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_org_invite(uuid, text, integer, integer, boolean, uuid) TO authenticated;

-- 3. Update send_org_invite_emails to accept optional p_team_id
CREATE OR REPLACE FUNCTION send_org_invite_emails(
  p_org_id  uuid,
  p_emails  text[],
  p_role    text DEFAULT 'coach',
  p_team_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_caller_role text;
  v_org_name   text;
  v_app_url    text;
  v_email      text;
  v_code       text;
  v_sent       integer := 0;
BEGIN
  -- Auth: must be org admin or platform admin; coaches can only send coach invites
  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role = 'coach')
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_role NOT IN ('coach', 'player', 'admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = p_org_id;
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  FOREACH v_email IN ARRAY p_emails LOOP
    -- Skip if there is already a pending invite for this email+org
    IF EXISTS (
      SELECT 1 FROM org_invites
      WHERE org_id = p_org_id AND email = v_email
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR used_count < max_uses)
    ) THEN
      CONTINUE;
    END IF;

    -- Generate unique code
    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
    END LOOP;

    INSERT INTO org_invites (org_id, code, role, email, created_by, max_uses, expires_at, team_id)
    VALUES (p_org_id, v_code, p_role, v_email, v_uid, 1, now() + interval '7 days', p_team_id);

    PERFORM _send_notification_email(
      v_email,
      'org_invite',
      jsonb_build_object(
        'org_name',   v_org_name,
        'role',       p_role,
        'invite_url', v_app_url || '/join/' || v_code
      )
    );

    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$$;

GRANT EXECUTE ON FUNCTION send_org_invite_emails(uuid, text[], text, uuid) TO authenticated;

-- 4. Update join_by_code to assign team membership when org_invite has team_id
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

      -- Assign to team if specified
      IF v_org_invite.team_id IS NOT NULL THEN
        INSERT INTO team_members (team_id, user_id, role)
          VALUES (v_org_invite.team_id, v_uid, v_org_invite.role)
          ON CONFLICT (team_id, user_id) DO NOTHING;
      END IF;

      UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
      RETURN jsonb_build_object('type', 'secondary_org', 'org_id', v_org_invite.org_id);
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

      -- Upsert into org_memberships
      INSERT INTO org_memberships (user_id, org_id, role)
        VALUES (v_uid, v_org_invite.org_id, v_new_role)
        ON CONFLICT (user_id, org_id) DO UPDATE SET role =
          CASE WHEN v_new_role = 'admin' THEN 'admin'
               WHEN org_memberships.role = 'admin' THEN 'admin'
               ELSE v_new_role END;

      -- Assign to team if specified
      IF v_org_invite.team_id IS NOT NULL THEN
        INSERT INTO team_members (team_id, user_id, role)
          VALUES (v_org_invite.team_id, v_uid, v_org_invite.role)
          ON CONFLICT (team_id, user_id) DO NOTHING;
      END IF;

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

GRANT EXECUTE ON FUNCTION join_by_code(text) TO authenticated;
