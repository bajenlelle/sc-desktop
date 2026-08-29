-- =============================================================================
-- Mobile push notifications.
--
-- Mirrors the email pipeline: a `_send_push_notification` sibling of
-- `_send_notification_email` posts to the `send-push` Edge Function via
-- pg_net, from the same trigger sites. Device tokens live in `push_tokens`,
-- written ONLY through SECURITY DEFINER RPCs: on a shared device a token must
-- move between users at sign-in, and no client RLS policy can allow updating
-- the previous owner's row.
--
-- Events wired here: playlist shared (team + direct), coach reminder, and
-- "added to a team" (push-only — its email died in an old refactor and was
-- deliberately not revived). License expiry stays email-only.
--
-- Config (app_config): reuses `notify_email_fn_url` (functions base URL) and
-- adds `notify_push_secret` — separate from the email secret so the two can
-- rotate independently. Missing config = silent no-op, same soft-launch
-- property as email.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Token storage. Server-written: RLS enabled, no policies.
-- ---------------------------------------------------------------------------
CREATE TABLE push_tokens (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android')),
  device_name text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION register_push_token(
  p_token text,
  p_platform text,
  p_device_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid_platform';
  END IF;

  -- ON CONFLICT reassigns the token to the caller — the shared-device case.
  INSERT INTO push_tokens (token, user_id, platform, device_name)
    VALUES (p_token, v_uid, p_platform, p_device_name)
    ON CONFLICT (token) DO UPDATE
      SET user_id = v_uid,
          platform = EXCLUDED.platform,
          device_name = EXCLUDED.device_name,
          updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION register_push_token(text, text, text) TO authenticated;

-- Deletes by token regardless of owner: possessing the unguessable token
-- string is proof of device possession, and sign-out must silence the device
-- even if the row was reassigned oddly.
CREATE OR REPLACE FUNCTION delete_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  DELETE FROM push_tokens WHERE token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_push_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Sender. Fire-and-forget, never aborts the calling transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _send_push_notification(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fn_url text;
  v_secret text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  -- Most users have no registered device; skip the HTTP round-trip entirely.
  IF NOT EXISTS (SELECT 1 FROM push_tokens WHERE user_id = p_user_id) THEN
    RETURN;
  END IF;

  SELECT value INTO v_fn_url FROM app_config WHERE key = 'notify_email_fn_url';
  IF v_fn_url IS NULL THEN
    RETURN;
  END IF;
  SELECT value INTO v_secret FROM app_config WHERE key = 'notify_push_secret';

  PERFORM net.http_post(
    url     := v_fn_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', COALESCE(v_secret, '')
    ),
    body    := jsonb_build_object(
      'user_id', p_user_id,
      'title',   p_title,
      'body',    p_body,
      'data',    COALESCE(p_data, '{}'::jsonb)
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[push] _send_push_notification failed for user %: %', p_user_id, SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------------
-- Team share: email loop gains a push per member.
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
  SELECT p.name, p.user_id, pr.full_name
    INTO v_playlist_name, v_creator_id, v_creator_name
    FROM playlists p
    LEFT JOIN profiles pr ON pr.id = p.user_id
    WHERE p.id = NEW.playlist_id;

  SELECT name INTO v_team_name FROM teams WHERE id = NEW.team_id;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_playlist_url := COALESCE(v_app_url, 'https://app.scoutable.se')
                      || '/my-playlists?p=' || NEW.playlist_id;

  FOR v_member IN
    SELECT tm.user_id, u.email
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
    PERFORM _send_push_notification(
      v_member.user_id,
      COALESCE(v_creator_name, 'Your coach') || ' shared a playlist',
      COALESCE(v_playlist_name, 'Playlist') || ' · ' || COALESCE(v_team_name, 'your team'),
      jsonb_build_object('type', 'playlist_shared', 'playlistId', NEW.playlist_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Direct share: push alongside the email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_playlist_user_shared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_playlist_name text;
  v_sharer_name   text;
  v_recipient     text;
  v_app_url       text;
BEGIN
  SELECT p.name INTO v_playlist_name
    FROM playlists p WHERE p.id = NEW.playlist_id;

  -- Direct shares record who sent them, which is more precise than the
  -- playlist owner (a coach can share a playlist they didn't create).
  SELECT pr.full_name INTO v_sharer_name
    FROM profiles pr WHERE pr.id = NEW.shared_by;

  SELECT u.email INTO v_recipient
    FROM auth.users u WHERE u.id = NEW.user_id;

  -- Nothing to do if the coach shared a playlist with themselves.
  IF v_recipient IS NULL OR NEW.user_id = NEW.shared_by THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';

  PERFORM _send_notification_email(
    v_recipient,
    'playlist_shared',
    jsonb_build_object(
      'playlist_name', COALESCE(v_playlist_name, 'Playlist'),
      'sharer_name',   COALESCE(v_sharer_name, 'Your coach'),
      'is_direct',     true,
      'playlist_url',  COALESCE(v_app_url, 'https://app.scoutable.se')
                         || '/my-playlists?p=' || NEW.playlist_id
    )
  );

  PERFORM _send_push_notification(
    NEW.user_id,
    COALESCE(v_sharer_name, 'Your coach') || ' shared a playlist with you',
    COALESCE(v_playlist_name, 'Playlist'),
    jsonb_build_object('type', 'playlist_shared', 'playlistId', NEW.playlist_id)
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Coach reminder: push alongside the email. Full body re-stated; the 24h
-- rate limit is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_playlist_reminder(p_playlist_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_playlist_name text;
  v_coach_name    text;
  v_recipient     text;
  v_app_url       text;
  v_last_sent     timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT p.name INTO v_playlist_name
    FROM playlists p
    WHERE p.id = p_playlist_id AND p.user_id = v_uid;
  IF v_playlist_name IS NULL THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- The target must actually receive this playlist (direct or via a team).
  IF NOT EXISTS (
    SELECT 1 FROM playlist_user_shares pus
      WHERE pus.playlist_id = p_playlist_id AND pus.user_id = p_user_id
    UNION ALL
    SELECT 1 FROM playlist_shares ps
      JOIN team_members tm ON tm.team_id = ps.team_id
      WHERE ps.playlist_id = p_playlist_id AND tm.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not_recipient';
  END IF;

  SELECT sent_at INTO v_last_sent
    FROM playlist_reminders
    WHERE playlist_id = p_playlist_id AND user_id = p_user_id;
  IF v_last_sent IS NOT NULL AND v_last_sent > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'too_soon';
  END IF;

  INSERT INTO playlist_reminders (playlist_id, user_id, sent_by)
    VALUES (p_playlist_id, p_user_id, v_uid)
    ON CONFLICT (playlist_id, user_id)
    DO UPDATE SET sent_at = now(), sent_by = EXCLUDED.sent_by;

  SELECT pr.full_name INTO v_coach_name FROM profiles pr WHERE pr.id = v_uid;
  SELECT u.email INTO v_recipient FROM auth.users u WHERE u.id = p_user_id;
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';

  IF v_recipient IS NOT NULL THEN
    PERFORM _send_notification_email(
      v_recipient,
      'playlist_reminder',
      jsonb_build_object(
        'playlist_name', COALESCE(v_playlist_name, 'Playlist'),
        'coach_name',    COALESCE(v_coach_name, 'Your coach'),
        'playlist_url',  COALESCE(v_app_url, 'https://app.scoutable.se')
                           || '/my-playlists?p=' || p_playlist_id
      )
    );
  END IF;

  PERFORM _send_push_notification(
    p_user_id,
    'A nudge from ' || COALESCE(v_coach_name, 'your coach'),
    'You have clips waiting in ' || COALESCE(v_playlist_name, 'a playlist'),
    jsonb_build_object('type', 'playlist_reminder', 'playlistId', p_playlist_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION send_playlist_reminder(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Added to a team: push-only, on the table rather than in any RPC because six
-- distinct write paths insert into team_members. Self-joins (join code,
-- create-team self-insert) are skipped — the joiner is inside the app at that
-- moment and the in-app success screen is the welcome. The NULL guard also
-- keeps service-role backfills from notifying anyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_team_member_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name text;
  v_org_name  text;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT t.name, o.name INTO v_team_name, v_org_name
    FROM teams t
    JOIN organizations o ON o.id = t.org_id
    WHERE t.id = NEW.team_id;

  PERFORM _send_push_notification(
    NEW.user_id,
    'You''re on ' || COALESCE(v_team_name, 'a team'),
    'You''ve been added to ' || COALESCE(v_team_name, 'a team')
      || ' at ' || COALESCE(v_org_name, 'your organization'),
    jsonb_build_object('type', 'added_to_team')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_members_notify_added ON team_members;
CREATE TRIGGER team_members_notify_added
  AFTER INSERT ON team_members
  FOR EACH ROW EXECUTE FUNCTION notify_team_member_added();
