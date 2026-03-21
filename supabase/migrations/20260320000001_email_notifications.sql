-- =============================================================================
-- 20260320000001: Transactional email notifications (Tier 1)
--
-- Emails sent:
--   1. user_joined_org    → org admin when someone joins via org invite
--   2. added_to_team      → user when added to a team (invite or admin assign)
--   3. removed_from_org   → user when removed from org
--   4. promoted_to_admin  → user when promoted to admin
--   5. playlist_shared    → all team members when a playlist is shared with their team
--   6. license_expiry     → org admin at 30d / 7d / 1d before plan expiry
--
-- Setup required after deployment:
--   1. Deploy the send-email Edge Function (supabase/functions/send-email/).
--   2. Set Edge Function secrets in the Supabase dashboard:
--        EMAIL_NOTIFICATION_SECRET = <any random string>
--        APP_URL                   = https://app.scoutable.se  (or your domain)
--        (RESEND_API_KEY or RESEND_SMTP_PASSWORD already set for Auth emails)
--   3. Insert config rows into app_config:
--        INSERT INTO app_config (key, value) VALUES
--          ('notify_email_fn_url', 'https://<project-ref>.supabase.co/functions/v1'),
--          ('notify_email_secret', '<same value as EMAIL_NOTIFICATION_SECRET>'),
--          ('app_url',             'https://app.scoutable.se');
--   4. Schedule the license expiry checker (once pg_cron is available):
--        SELECT cron.schedule('notify-license-expiry', '0 9 * * *',
--          'SELECT notify_expiring_licenses()');
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable pg_net (async HTTP from SQL)
--    Supabase pre-installs pg_net; this is a no-op on hosted projects.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 2. App config table (key/value store for runtime settings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Only platform admins and the service role can read/write config.
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_config_platform_admin ON app_config
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. Internal email helper: fire-and-forget via pg_net → Edge Function
--    Silently no-ops if app_config is not populated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _send_notification_email(
  p_to       text,
  p_template text,
  p_data     jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fn_url text;
  v_secret text;
  v_body   jsonb;
BEGIN
  IF p_to IS NULL OR p_to = '' THEN RETURN; END IF;

  SELECT value INTO v_fn_url FROM app_config WHERE key = 'notify_email_fn_url';
  IF v_fn_url IS NULL THEN RETURN; END IF;  -- not configured yet, skip silently

  SELECT value INTO v_secret FROM app_config WHERE key = 'notify_email_secret';

  v_body := jsonb_build_object(
    'to',       p_to,
    'template', p_template,
    'data',     p_data
  );

  PERFORM net.http_post(
    url     := v_fn_url || '/send-email',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-email-secret',  COALESCE(v_secret, '')
    ),
    body    := v_body
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let email failures break the main operation
  RAISE WARNING '[email] _send_notification_email failed for template %: %', p_template, SQLERRM;
END;
$$;

-- Convenience: look up a user's email from auth.users
CREATE OR REPLACE FUNCTION _get_user_email(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = p_user_id
$$;

-- Convenience: look up the org admin's email
CREATE OR REPLACE FUNCTION _get_org_admin_email(p_org_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT u.email
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.org_id = p_org_id AND p.role = 'admin'
  ORDER BY p.created_at
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 4. Replace join_by_code() — adds email notifications on success paths
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

  -- Email helpers
  v_user_email    text;
  v_user_name     text;
  v_admin_email   text;
  v_team_name     text;
  v_app_url       text;
BEGIN
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';

  -- ---- Org invite path ----
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

    -- License checks
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

    -- Email: notify org admin that a new member joined
    SELECT u.email, p.full_name
      INTO v_user_email, v_user_name
      FROM auth.users u JOIN profiles p ON p.id = u.id
      WHERE u.id = v_uid;

    v_admin_email := _get_org_admin_email(v_org_invite.org_id);
    IF v_admin_email IS NOT NULL AND v_admin_email != v_user_email THEN
      PERFORM _send_notification_email(
        v_admin_email,
        'user_joined_org',
        jsonb_build_object(
          'user_name', COALESCE(v_user_name, v_user_email, 'A new user'),
          'org_name',  COALESCE(v_org.name, 'your organization'),
          'org_url',   COALESCE(v_app_url, 'https://app.scoutable.se') || '/organization'
        )
      );
    END IF;

    RETURN jsonb_build_object('type', 'org', 'org_id', v_org_invite.org_id);
  END IF;

  -- ---- Team invite path ----
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

    -- License checks
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

    -- Email: notify joining user about team membership
    SELECT u.email, p.full_name
      INTO v_user_email, v_user_name
      FROM auth.users u JOIN profiles p ON p.id = u.id
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

    -- Email: notify org admin if this is the user's first join to the org
    IF v_cur_org_id IS NULL THEN
      v_admin_email := _get_org_admin_email(v_org_id);
      IF v_admin_email IS NOT NULL AND v_admin_email != v_user_email THEN
        PERFORM _send_notification_email(
          v_admin_email,
          'user_joined_org',
          jsonb_build_object(
            'user_name', COALESCE(v_user_name, v_user_email, 'A new user'),
            'org_name',  COALESCE(v_org.name, 'your organization'),
            'org_url',   COALESCE(v_app_url, 'https://app.scoutable.se') || '/organization'
          )
        );
      END IF;
    END IF;

    RETURN jsonb_build_object('type', 'team', 'org_id', v_org_id, 'team_id', v_team_invite.team_id);
  END IF;

  RAISE EXCEPTION 'invalid_code';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Replace assign_member_to_team() — notify assigned member
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
  v_uid        uuid := auth.uid();
  v_admin_org  uuid;
  v_team_name  text;
  v_org_name   text;
  v_user_email text;
BEGIN
  -- Guard: caller must be admin
  SELECT org_id INTO v_admin_org FROM profiles WHERE id = v_uid AND role = 'admin';
  IF v_admin_org IS NULL THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Guard: team must belong to caller's org and user must be in same org
  IF NOT EXISTS (
    SELECT 1
    FROM teams t
    JOIN profiles p ON p.id = p_user_id AND p.org_id = t.org_id
    WHERE t.id = p_team_id AND t.org_id = v_admin_org
  ) THEN
    RAISE EXCEPTION 'user_or_team_not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, p_user_id, p_role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = p_role;

  -- Email: notify the assigned member
  v_user_email := _get_user_email(p_user_id);

  SELECT t.name, o.name INTO v_team_name, v_org_name
    FROM teams t JOIN organizations o ON o.id = t.org_id
    WHERE t.id = p_team_id;

  IF v_user_email IS NOT NULL THEN
    PERFORM _send_notification_email(
      v_user_email,
      'added_to_team',
      jsonb_build_object(
        'team_name', COALESCE(v_team_name, 'your team'),
        'org_name',  COALESCE(v_org_name, 'your organization')
      )
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Replace promote_to_admin() — notify promoted member
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
  v_org_name   text;
  v_user_email text;
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

  -- Email: notify promoted member
  v_user_email := _get_user_email(p_user_id);
  SELECT name INTO v_org_name FROM organizations WHERE id = v_target_org;

  IF v_user_email IS NOT NULL THEN
    PERFORM _send_notification_email(
      v_user_email,
      'promoted_to_admin',
      jsonb_build_object(
        'org_name', COALESCE(v_org_name, 'your organization')
      )
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Replace remove_member_from_org() — notify removed member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member_from_org(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_org  uuid;
  v_target_org  uuid;
  v_org_name    text;
  v_user_email  text;
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

  -- Capture email and org name BEFORE removing (so we have the data)
  v_user_email := _get_user_email(p_user_id);
  SELECT name INTO v_org_name FROM organizations WHERE id = v_target_org;

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

  -- Email: notify removed member (sent after the removal so DB is clean)
  IF v_user_email IS NOT NULL AND v_org_name IS NOT NULL THEN
    PERFORM _send_notification_email(
      v_user_email,
      'removed_from_org',
      jsonb_build_object('org_name', v_org_name)
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Trigger: notify team members when a playlist is shared with their team
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_playlist_shared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_playlist_name text;
  v_creator_id    uuid;
  v_creator_name  text;
  v_team_name     text;
  v_playlist_url  text;
  v_app_url       text;
  v_member        record;
BEGIN
  -- Look up playlist metadata
  SELECT p.name, p.user_id, pr.full_name
    INTO v_playlist_name, v_creator_id, v_creator_name
    FROM playlists p
    LEFT JOIN profiles pr ON pr.id = p.user_id
    WHERE p.id = NEW.playlist_id;

  SELECT name INTO v_team_name FROM teams WHERE id = NEW.team_id;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_playlist_url := COALESCE(v_app_url, 'https://app.scoutable.se') || '/my-playlists';

  -- Send to every team member except the creator
  FOR v_member IN
    SELECT u.email
      FROM team_members tm
      JOIN auth.users u ON u.id = tm.user_id
      WHERE tm.team_id = NEW.team_id
        AND tm.user_id IS DISTINCT FROM v_creator_id
  LOOP
    PERFORM _send_notification_email(
      v_member.email,
      'playlist_shared',
      jsonb_build_object(
        'playlist_name', COALESCE(v_playlist_name, 'Playlist'),
        'sharer_name',   COALESCE(v_creator_name, 'Your coach'),
        'team_name',     COALESCE(v_team_name, 'your team'),
        'playlist_url',  v_playlist_url
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playlist_shares_notify ON playlist_shares;
CREATE TRIGGER playlist_shares_notify
  AFTER INSERT ON playlist_shares
  FOR EACH ROW EXECUTE FUNCTION notify_playlist_shared();

-- ---------------------------------------------------------------------------
-- 9. License expiry warnings (scheduled job)
-- ---------------------------------------------------------------------------

-- Tracks which warning intervals have already been sent to avoid re-sending.
CREATE TABLE IF NOT EXISTS license_expiry_warnings (
  org_id      uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  days_notice integer NOT NULL,  -- 30, 7, or 1
  sent_at     timestamptz DEFAULT now(),
  PRIMARY KEY (org_id, days_notice)
);

ALTER TABLE license_expiry_warnings ENABLE ROW LEVEL SECURITY;

-- Only the service role (via SECURITY DEFINER functions) can touch this table.

CREATE OR REPLACE FUNCTION notify_expiring_licenses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec         record;
  v_admin_email text;
  v_days        integer;
  v_manage_url  text;
  v_app_url     text;
BEGIN
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_manage_url := COALESCE(v_app_url, 'https://app.scoutable.se') || '/organization';

  -- Check at each threshold: 30d, 7d, 1d
  FOREACH v_days IN ARRAY ARRAY[30, 7, 1] LOOP
    FOR v_rec IN
      SELECT o.id, o.name
        FROM organizations o
        WHERE o.expires_at IS NOT NULL
          AND o.expires_at > now()
          AND o.expires_at <= (now() + (v_days || ' days')::interval)
          AND NOT EXISTS (
            SELECT 1 FROM license_expiry_warnings w
            WHERE w.org_id = o.id AND w.days_notice = v_days
          )
    LOOP
      v_admin_email := _get_org_admin_email(v_rec.id);

      IF v_admin_email IS NOT NULL THEN
        PERFORM _send_notification_email(
          v_admin_email,
          'license_expiry',
          jsonb_build_object(
            'org_name',          v_rec.name,
            'days_until_expiry', v_days::text,
            'manage_url',        v_manage_url
          )
        );

        -- Mark as sent so we don't repeat this threshold
        INSERT INTO license_expiry_warnings (org_id, days_notice)
          VALUES (v_rec.id, v_days)
          ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Schedule daily at 09:00 UTC if pg_cron is available.
-- Run manually in production after confirming pg_cron is enabled:
--   SELECT cron.schedule('notify-license-expiry', '0 9 * * *', 'SELECT notify_expiring_licenses()');
