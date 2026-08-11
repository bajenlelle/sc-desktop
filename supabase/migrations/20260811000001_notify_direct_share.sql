-- =============================================================================
-- Notify players when a playlist is shared with them directly.
--
-- `notify_playlist_shared` only fires on `playlist_shares` (team shares), so a
-- coach sharing a playlist with an individual player sent no email at all —
-- the player had no way to learn there was anything to watch.
--
-- Also points both share emails at the playlist itself rather than the bare
-- list page, so the CTA lands on the clips.
-- =============================================================================

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playlist_user_shares_notify ON playlist_user_shares;
CREATE TRIGGER playlist_user_shares_notify
  AFTER INSERT ON playlist_user_shares
  FOR EACH ROW EXECUTE FUNCTION notify_playlist_user_shared();

-- ---------------------------------------------------------------------------
-- Team-share emails: deep-link to the playlist too.
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
