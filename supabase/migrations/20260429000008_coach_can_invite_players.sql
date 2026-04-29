-- =============================================================================
-- 20260429000008: Allow coaches to invite players
--
-- Previously coaches could only generate invites with role='coach'.
-- Now coaches can generate invites for role IN ('coach', 'player').
-- Admin-only invites remain restricted to admins and platform admins.
-- =============================================================================

-- generate_org_invite
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
    OR (v_caller_role = 'coach' AND p_role IN ('coach', 'player'))
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

-- send_org_invite_emails
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
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_is_nt_org   boolean;
  v_org_name    text;
  v_app_url     text;
  v_email       text;
  v_code        text;
  v_sent        integer := 0;
BEGIN
  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role IN ('coach', 'player'))
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_role NOT IN ('coach', 'player', 'admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT name, COALESCE(is_nt_org, false)
  INTO v_org_name, v_is_nt_org
  FROM organizations WHERE id = p_org_id;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  FOREACH v_email IN ARRAY p_emails LOOP
    IF EXISTS (
      SELECT 1 FROM org_invites
      WHERE org_id = p_org_id AND email = v_email
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR used_count < max_uses)
    ) THEN
      CONTINUE;
    END IF;

    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
    END LOOP;

    INSERT INTO org_invites (org_id, code, role, email, created_by, max_uses, expires_at, is_national_team, team_id)
    VALUES (p_org_id, v_code, p_role, v_email, v_uid, 1, now() + interval '7 days', v_is_nt_org, p_team_id);

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
