-- =============================================================================
-- Invite codes: staff-only reads, RPC-only writes, email-bound staff invites
--
-- org_invites and team_invites were readable by any signed-in user, and both
-- tables took direct inserts. Nothing needs either: staff read their own
-- org's invites (the invite dialog, the setup checklist, the admin pages), the
-- public join page reads through get_invite_preview (SECURITY DEFINER), and
-- every invite is created by generate_org_invite, generate_team_invite or
-- send_org_invite_emails.
--
-- Also:
-- - An emailed admin or coach invite now works only for the address it was
--   sent to (invite_email_mismatch). Invites without an email, the shareable
--   links, are unchanged: a player link posted in a team chat keeps working.
-- - An invite's team must belong to its org, at creation (team_not_in_org)
--   and again at join. Prod had no invite pointing at another org's team.
-- - Live admin codes are expired. Clubs that still need an admin get a fresh
--   link from /admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reads: staff of the org (and platform admins); a team invite also to the
--    team member who created it (generate_team_invite lets any member).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_invites_select_all ON org_invites;
CREATE POLICY org_invites_select_staff ON org_invites FOR SELECT
  USING ((SELECT is_platform_admin()) OR is_org_admin_or_coach(org_id));

DROP POLICY IF EXISTS team_invites_select_all ON team_invites;
CREATE POLICY team_invites_select_own_or_staff ON team_invites FOR SELECT
  USING (
    created_by = (SELECT auth.uid())
    OR (SELECT is_platform_admin())
    OR team_id IN (SELECT t.id FROM teams t WHERE is_org_admin_or_coach(t.org_id))
  );

-- ---------------------------------------------------------------------------
-- 2. Writes: only through the invite RPCs, which carry the role, licence and
--    team checks. With RLS on and no INSERT policy, a direct insert is denied.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_invites_insert_admin ON org_invites;
DROP POLICY IF EXISTS team_invites_insert_member ON team_invites;

-- ---------------------------------------------------------------------------
-- 3. join_by_code: email binding for staff invites, same-org teams only.
--    Otherwise identical to 20260902100000_license_lifecycle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_by_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_code         text := upper(trim(p_code));
  v_org_invite   org_invites%ROWTYPE;
  v_team_invite  team_invites%ROWTYPE;
  v_org          organizations%ROWTYPE;
  v_org_id       uuid;
  v_coach_count  integer;
  v_player_count integer;
  v_was_member   boolean;
  v_user_email   text;
  v_user_name    text;
  v_admin_email  text;
  v_team_name    text;
  v_app_url      text;
BEGIN
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  -- Try org_invites first
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    -- An emailed admin or coach invite is for that address only. Links
    -- without an email stay shareable (a player link in a team chat).
    IF v_org_invite.email IS NOT NULL AND v_org_invite.role IN ('admin', 'coach')
       AND lower(trim(v_org_invite.email)) IS DISTINCT FROM
           (SELECT lower(email) FROM auth.users WHERE id = v_uid) THEN
      RAISE EXCEPTION 'invite_email_mismatch';
    END IF;

    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    -- Seat limit check (counts existing members, excluding self for re-join)
    IF v_org_invite.role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count
          FROM org_memberships
          WHERE org_id = v_org.id
            AND role IN ('coach', 'admin')
            AND user_id != v_uid;
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_org_invite.role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count
          FROM org_memberships
          WHERE org_id = v_org.id
            AND role = 'player'
            AND user_id != v_uid;
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
    END IF;

    v_was_member := EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id
    );

    -- Additive join — no primary/secondary distinction, no profiles.org_id write
    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org.id, v_org_invite.role)
      ON CONFLICT (user_id, org_id) DO UPDATE SET role =
        CASE WHEN v_org_invite.role = 'admin' THEN 'admin'
             WHEN org_memberships.role = 'admin' THEN 'admin'
             ELSE v_org_invite.role END;

    -- Only a team of the invite's own org; team_members.role has no 'admin'.
    IF v_org_invite.team_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM teams WHERE id = v_org_invite.team_id AND org_id = v_org.id) THEN
      INSERT INTO team_members (team_id, user_id, role)
        VALUES (v_org_invite.team_id, v_uid,
                CASE WHEN v_org_invite.role = 'player' THEN 'player' ELSE 'coach' END)
        ON CONFLICT (team_id, user_id) DO NOTHING;
    END IF;

    UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;

    -- Email: notify org admins about first-time joins
    IF NOT v_was_member THEN
      SELECT u.email, p.full_name INTO v_user_email, v_user_name
        FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
        WHERE u.id = v_uid;
      FOR v_admin_email IN SELECT * FROM _get_org_admin_emails(v_org.id) LOOP
        IF v_admin_email != v_user_email THEN
          PERFORM _send_notification_email(
            v_admin_email,
            'user_joined_org',
            jsonb_build_object(
              'user_name', COALESCE(v_user_name, v_user_email, 'A new user'),
              'org_name',  COALESCE(v_org.name, 'your organization'),
              'org_url',   v_app_url || '/organization'
            )
          );
        END IF;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('type', 'org', 'org_id', v_org.id);
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
    SELECT * INTO v_org FROM organizations WHERE id = v_org_id;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    -- Seat limit check
    IF v_team_invite.role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count
          FROM org_memberships
          WHERE org_id = v_org_id
            AND role IN ('coach', 'admin')
            AND user_id != v_uid;
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_team_invite.role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count
          FROM org_memberships
          WHERE org_id = v_org_id
            AND role = 'player'
            AND user_id != v_uid;
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
    END IF;

    v_was_member := EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org_id
    );

    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org_id, v_team_invite.role)
      ON CONFLICT (user_id, org_id) DO NOTHING;

    INSERT INTO team_members (team_id, user_id, role)
      VALUES (v_team_invite.team_id, v_uid, v_team_invite.role)
      ON CONFLICT (team_id, user_id) DO NOTHING;

    UPDATE team_invites SET used_count = used_count + 1 WHERE id = v_team_invite.id;

    -- Emails: welcome the member to the team; tell admins about first joins
    SELECT u.email, p.full_name INTO v_user_email, v_user_name
      FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
      WHERE u.id = v_uid;
    SELECT name INTO v_team_name FROM teams WHERE id = v_team_invite.team_id;

    IF v_user_email IS NOT NULL THEN
      PERFORM _send_notification_email(
        v_user_email,
        'added_to_team',
        jsonb_build_object(
          'team_name', COALESCE(v_team_name, 'your team'),
          'org_name',  COALESCE(v_org.name, 'your organization')
        )
      );
    END IF;

    IF NOT v_was_member THEN
      FOR v_admin_email IN SELECT * FROM _get_org_admin_emails(v_org_id) LOOP
        IF v_admin_email != v_user_email THEN
          PERFORM _send_notification_email(
            v_admin_email,
            'user_joined_org',
            jsonb_build_object(
              'user_name', COALESCE(v_user_name, v_user_email, 'A new user'),
              'org_name',  COALESCE(v_org.name, 'your organization'),
              'org_url',   v_app_url || '/organization'
            )
          );
        END IF;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('type', 'team', 'org_id', v_org_id, 'team_id', v_team_invite.team_id);
  END IF;

  RAISE EXCEPTION 'invalid_code';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Invite creation: the team must belong to the org.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_org_invite(p_org_id uuid, p_role text DEFAULT 'coach'::text, p_max_uses integer DEFAULT NULL::integer, p_expires_in_hours integer DEFAULT NULL::integer, p_is_national_team boolean DEFAULT false, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_is_nt_org   boolean;
  v_expires     timestamptz;
  v_code        text;
BEGIN
  SELECT COALESCE(o.is_nt_org, false), o.expires_at INTO v_is_nt_org, v_expires
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

  -- Platform admins can still mint codes (e.g. bootstrapping a renewal), but
  -- org members can't invite into an expired org.
  IF NOT is_platform_admin() AND v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'license_expired';
  END IF;

  IF p_team_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'team_not_in_org';
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
$function$;

CREATE OR REPLACE FUNCTION public.send_org_invite_emails(p_org_id uuid, p_emails text[], p_role text DEFAULT 'coach'::text, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_is_nt_org   boolean;
  v_org_name    text;
  v_expires     timestamptz;
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

  SELECT name, COALESCE(is_nt_org, false), expires_at
  INTO v_org_name, v_is_nt_org, v_expires
  FROM organizations WHERE id = p_org_id;

  IF NOT is_platform_admin() AND v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'license_expired';
  END IF;

  IF p_team_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'team_not_in_org';
  END IF;

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
$function$;

-- ---------------------------------------------------------------------------
-- 5. Expire live admin codes.
-- ---------------------------------------------------------------------------
UPDATE org_invites
   SET expires_at = now()
 WHERE role = 'admin'
   AND (expires_at IS NULL OR expires_at > now())
   AND (max_uses IS NULL OR used_count < max_uses);
