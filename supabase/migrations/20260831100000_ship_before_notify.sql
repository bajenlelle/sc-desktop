-- =============================================================================
-- Ship before notify.
--
-- Share-row inserts used to notify recipients (email + push) immediately,
-- but clips only become watchable once the desktop uploads them to R2 —
-- players were opening "empty" playlists minutes before content existed
-- (or forever, when the share came from a dashboard that can't upload).
--
-- New rule, enforced here regardless of client: a share notifies at INSERT
-- only when the playlist already has at least one shipped clip. Otherwise
-- the row is created silently ("pending", notified_at IS NULL) and
-- `notify_pending_playlist_shares` — called by the desktop after a
-- successful upload — delivers the notification once content is real.
--
-- The triggers move from AFTER to BEFORE INSERT so they can stamp
-- NEW.notified_at. BEFORE INSERT still doesn't fire on the client upserts'
-- ON CONFLICT DO UPDATE branch, so re-confirming an existing recipient
-- keeps not re-notifying.
-- =============================================================================

ALTER TABLE playlist_shares ADD COLUMN notified_at timestamptz;
ALTER TABLE playlist_user_shares ADD COLUMN notified_at timestamptz;

-- Every pre-existing row was notified under the old at-insert regime.
UPDATE playlist_shares SET notified_at = shared_at;
UPDATE playlist_user_shares SET notified_at = shared_at;

-- ---------------------------------------------------------------------------
-- Shared notification bodies, callable from both the triggers and the RPC.
-- ---------------------------------------------------------------------------

-- Notify one direct-share recipient. Skips self-shares.
CREATE OR REPLACE FUNCTION _notify_user_share(
  p_playlist_id uuid,
  p_user_id uuid,
  p_shared_by uuid
)
RETURNS void
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
    FROM playlists p WHERE p.id = p_playlist_id;

  -- Direct shares record who sent them, which is more precise than the
  -- playlist owner (a coach can share a playlist they didn't create).
  SELECT pr.full_name INTO v_sharer_name
    FROM profiles pr WHERE pr.id = p_shared_by;

  SELECT u.email INTO v_recipient
    FROM auth.users u WHERE u.id = p_user_id;

  IF v_recipient IS NULL OR p_user_id = p_shared_by THEN
    RETURN;
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
                         || '/my-playlists?p=' || p_playlist_id
    )
  );

  PERFORM _send_push_notification(
    p_user_id,
    COALESCE(v_sharer_name, 'Your coach') || ' shared a playlist with you',
    COALESCE(v_playlist_name, 'Playlist'),
    jsonb_build_object('type', 'playlist_shared', 'playlistId', p_playlist_id)
  );
END;
$$;

-- Notify every member of a team share, excluding the playlist creator.
CREATE OR REPLACE FUNCTION _notify_team_share(p_playlist_id uuid, p_team_id uuid)
RETURNS void
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
    WHERE p.id = p_playlist_id;

  SELECT name INTO v_team_name FROM teams WHERE id = p_team_id;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_playlist_url := COALESCE(v_app_url, 'https://app.scoutable.se')
                      || '/my-playlists?p=' || p_playlist_id;

  FOR v_member IN
    SELECT tm.user_id, u.email
      FROM team_members tm
      JOIN auth.users u ON u.id = tm.user_id
      WHERE tm.team_id = p_team_id
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
      jsonb_build_object('type', 'playlist_shared', 'playlistId', p_playlist_id)
    );
  END LOOP;
END;
$$;

-- True when the playlist has at least one clip a recipient could watch.
CREATE OR REPLACE FUNCTION _playlist_has_shipped_clips(p_playlist_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM playlist_clips
    WHERE playlist_id = p_playlist_id AND r2_url IS NOT NULL
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers: notify at insert only when content is ready; otherwise pending.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_playlist_shared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _playlist_has_shipped_clips(NEW.playlist_id) THEN
    PERFORM _notify_team_share(NEW.playlist_id, NEW.team_id);
    NEW.notified_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playlist_shares_notify ON playlist_shares;
CREATE TRIGGER playlist_shares_notify
  BEFORE INSERT ON playlist_shares
  FOR EACH ROW EXECUTE FUNCTION notify_playlist_shared();

CREATE OR REPLACE FUNCTION notify_playlist_user_shared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _playlist_has_shipped_clips(NEW.playlist_id) THEN
    PERFORM _notify_user_share(NEW.playlist_id, NEW.user_id, NEW.shared_by);
    NEW.notified_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playlist_user_shares_notify ON playlist_user_shares;
CREATE TRIGGER playlist_user_shares_notify
  BEFORE INSERT ON playlist_user_shares
  FOR EACH ROW EXECUTE FUNCTION notify_playlist_user_shared();

-- ---------------------------------------------------------------------------
-- Deferred delivery: the desktop calls this after a successful upload run.
-- Idempotent — rows notify exactly once.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_pending_playlist_shares(p_playlist_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_share record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM playlists WHERE id = p_playlist_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Never deliver a notification that would land on an empty playlist.
  IF NOT _playlist_has_shipped_clips(p_playlist_id) THEN
    RETURN;
  END IF;

  FOR v_share IN
    SELECT id, user_id, shared_by FROM playlist_user_shares
      WHERE playlist_id = p_playlist_id AND notified_at IS NULL
  LOOP
    PERFORM _notify_user_share(p_playlist_id, v_share.user_id, v_share.shared_by);
    UPDATE playlist_user_shares SET notified_at = now() WHERE id = v_share.id;
  END LOOP;

  FOR v_share IN
    SELECT id, team_id FROM playlist_shares
      WHERE playlist_id = p_playlist_id AND notified_at IS NULL
  LOOP
    PERFORM _notify_team_share(p_playlist_id, v_share.team_id);
    UPDATE playlist_shares SET notified_at = now() WHERE id = v_share.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_pending_playlist_shares(uuid) TO authenticated;
