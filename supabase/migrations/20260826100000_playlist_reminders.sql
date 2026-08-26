-- =============================================================================
-- Playlist watch reminders ("Remind" on the coach dashboard).
--
-- A coach can nudge a recipient who hasn't finished a playlist. The table
-- exists to rate-limit: one reminder per (playlist, recipient) per 24 hours,
-- enforced server-side so no client can spam players. Rows are written only
-- through the SECURITY DEFINER RPC — RLS is enabled with no policies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS playlist_reminders (
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_by     uuid NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, user_id)
);

ALTER TABLE playlist_reminders ENABLE ROW LEVEL SECURITY;

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
END;
$$;

GRANT EXECUTE ON FUNCTION send_playlist_reminder(uuid, uuid) TO authenticated;
