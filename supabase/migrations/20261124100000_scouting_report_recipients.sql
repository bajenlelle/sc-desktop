-- Scouting reports on players' phones (docs/scouting-reports.md, "On players'
-- phones").
--
-- A coach sends a live report to teams and players of the club its playlist
-- belongs to. The people it reaches see it in the app (get_my_scouting_reports
-- lists it, get_scouting_report reads it as before), get a push, and their
-- reading is recorded (record_scouting_report_read): when they opened it and
-- which clips they watched, by clip key, so an update that renumbers the clips
-- keeps what was watched. The coach sees it per person
-- (get_scouting_report_delivery); the app tells players their coach sees it.
--
-- Both tables are written only by these functions (RLS on, no policies, no
-- grants). A report reaches a person only while it is live and they are in its
-- club: someone who leaves the club or the team stops seeing it.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE scouting_report_recipients (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES scouting_reports(id) ON DELETE CASCADE,
  team_id   uuid REFERENCES teams(id) ON DELETE CASCADE,
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scouting_report_recipients_one_target CHECK ((team_id IS NULL) <> (user_id IS NULL))
);

CREATE UNIQUE INDEX scouting_report_recipients_team
  ON scouting_report_recipients (report_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX scouting_report_recipients_user
  ON scouting_report_recipients (report_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX scouting_report_recipients_by_team ON scouting_report_recipients (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX scouting_report_recipients_by_user ON scouting_report_recipients (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE scouting_report_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scouting_report_recipients FROM anon, authenticated;

CREATE TABLE scouting_report_reads (
  report_id         uuid NOT NULL REFERENCES scouting_reports(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  last_opened_at    timestamptz NOT NULL DEFAULT now(),
  watched_clip_keys text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (report_id, user_id)
);

CREATE INDEX scouting_report_reads_by_user ON scouting_report_reads (user_id);

ALTER TABLE scouting_report_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scouting_report_reads FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who a report reaches
-- ---------------------------------------------------------------------------
-- Everyone it was sent to, directly or through a team, who is in the report's
-- club now, without its owner. One row a person: a direct send names no team.
CREATE OR REPLACE FUNCTION _scouting_report_audience(p_report uuid)
RETURNS TABLE (user_id uuid, role text, team_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (a.user_id) a.user_id, om.role, a.team_id
    FROM (
      SELECT rr.user_id, NULL::uuid AS team_id, 1 AS ord
        FROM scouting_report_recipients rr
       WHERE rr.report_id = p_report AND rr.user_id IS NOT NULL
      UNION ALL
      SELECT tm.user_id, rr.team_id, 2 AS ord
        FROM scouting_report_recipients rr
        JOIN team_members tm ON tm.team_id = rr.team_id
       WHERE rr.report_id = p_report AND rr.team_id IS NOT NULL
    ) a
    JOIN scouting_reports r ON r.id = p_report
    JOIN org_memberships om ON om.user_id = a.user_id AND om.org_id = _playlist_club_org(r.playlist_id)
   WHERE a.user_id <> r.user_id
   ORDER BY a.user_id, a.ord;
$$;

REVOKE EXECUTE ON FUNCTION _scouting_report_audience(uuid) FROM PUBLIC, anon, authenticated;

-- "Sat 28 Nov" in Stockholm time, from the report's game; NULL without one or
-- when it doesn't read as a time.
CREATE OR REPLACE FUNCTION _scouting_report_game_day(p_content jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN to_char((p_content->'header'->'game'->>'at')::timestamptz AT TIME ZONE 'Europe/Stockholm', 'Dy FMDD Mon');
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION _scouting_report_game_day(jsonb) FROM PUBLIC, anon, authenticated;

-- The push a person gets for a report: sent, or updated.
CREATE OR REPLACE FUNCTION _notify_scouting_report(p_report uuid, p_user_id uuid, p_updated boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row    scouting_reports%ROWTYPE;
  v_sender text;
  v_name   text;
  v_day    text;
BEGIN
  SELECT * INTO v_row FROM scouting_reports WHERE id = p_report;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT NULLIF(trim(pr.full_name), '') INTO v_sender FROM profiles pr WHERE pr.id = v_row.user_id;
  v_name := COALESCE(NULLIF(trim(v_row.content->'header'->>'opponent'), ''), v_row.title);
  v_day := _scouting_report_game_day(v_row.content);

  PERFORM _send_push_notification(
    p_user_id,
    'Scouting report: ' || v_name,
    CASE
      WHEN p_updated THEN COALESCE(v_sender, 'Your coach') || ' updated the report'
      WHEN v_day IS NOT NULL THEN COALESCE(v_sender, 'Your coach') || ' sent you the report for ' || v_day
      ELSE COALESCE(v_sender, 'Your coach') || ' sent you a scouting report'
    END,
    jsonb_build_object('type', 'scouting_report', 'reportId', p_report)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION _notify_scouting_report(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- The owner's live report and its club, or the error that stops a send.
CREATE OR REPLACE FUNCTION _scouting_report_for_send(p_report uuid, p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row scouting_reports%ROWTYPE;
  v_org uuid;
BEGIN
  SELECT * INTO v_row FROM scouting_reports WHERE id = p_report AND user_id = p_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  IF v_row.revoked_at IS NOT NULL OR v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'report_not_live';
  END IF;
  v_org := _playlist_club_org(v_row.playlist_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'report_not_in_club';
  END IF;
  IF org_license_state(v_org) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;
  RETURN v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION _scouting_report_for_send(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The coach: send, take back, tell about an update, see who read it
-- ---------------------------------------------------------------------------
-- Sends the owner's live club report to teams of its club and to members of
-- its club. Sending again to a target already sent to changes nothing. Pushes
-- go to the people the report reaches for the first time. Returns
-- {reached, notified}.
CREATE OR REPLACE FUNCTION send_scouting_report(
  p_report   uuid,
  p_team_ids uuid[] DEFAULT '{}',
  p_user_ids uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_before  uuid[];
  v_after   uuid[];
  v_new     uuid;
  v_count   int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  v_org := _scouting_report_for_send(p_report, v_uid);

  p_team_ids := COALESCE(p_team_ids, '{}');
  p_user_ids := COALESCE(p_user_ids, '{}');
  IF cardinality(p_team_ids) + cardinality(p_user_ids) = 0 THEN
    RAISE EXCEPTION 'no_recipients';
  END IF;
  IF cardinality(p_team_ids) + cardinality(p_user_ids) > 200 THEN
    RAISE EXCEPTION 'too_many_recipients';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_team_ids) t(id)
     WHERE NOT EXISTS (SELECT 1 FROM teams WHERE teams.id = t.id AND teams.org_id = v_org)
  ) THEN
    RAISE EXCEPTION 'team_not_in_report_org';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_user_ids) u(id)
     WHERE NOT EXISTS (SELECT 1 FROM org_memberships om WHERE om.user_id = u.id AND om.org_id = v_org)
  ) THEN
    RAISE EXCEPTION 'recipient_not_in_org';
  END IF;

  SELECT COALESCE(array_agg(a.user_id), '{}') INTO v_before FROM _scouting_report_audience(p_report) a;

  INSERT INTO scouting_report_recipients (report_id, team_id, sent_by)
  SELECT p_report, t.id, v_uid FROM (SELECT DISTINCT unnest(p_team_ids) AS id) t
  ON CONFLICT (report_id, team_id) WHERE team_id IS NOT NULL DO NOTHING;

  INSERT INTO scouting_report_recipients (report_id, user_id, sent_by)
  SELECT p_report, u.id, v_uid FROM (SELECT DISTINCT unnest(p_user_ids) AS id) u
   WHERE u.id <> v_uid
  ON CONFLICT (report_id, user_id) WHERE user_id IS NOT NULL DO NOTHING;

  SELECT COALESCE(array_agg(a.user_id), '{}') INTO v_after FROM _scouting_report_audience(p_report) a;

  FOR v_new IN SELECT x FROM unnest(v_after) x WHERE NOT (x = ANY (v_before)) LOOP
    PERFORM _notify_scouting_report(p_report, v_new, false);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('reached', cardinality(v_after), 'notified', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION send_scouting_report(uuid, uuid[], uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION send_scouting_report(uuid, uuid[], uuid[]) FROM PUBLIC, anon;

-- Takes a team or a person off the report (exactly one of the two). Works
-- whatever the licence, like unsharing a playlist.
CREATE OR REPLACE FUNCTION unsend_scouting_report(p_report uuid, p_team_id uuid DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scouting_reports WHERE id = p_report AND user_id = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  IF (p_team_id IS NULL) = (p_user_id IS NULL) THEN
    RAISE EXCEPTION 'one_target';
  END IF;
  DELETE FROM scouting_report_recipients
   WHERE report_id = p_report
     AND (team_id = p_team_id OR user_id = p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION unsend_scouting_report(uuid, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION unsend_scouting_report(uuid, uuid, uuid) FROM PUBLIC, anon;

-- After Update link: one push to everyone the report reaches. Returns how many.
CREATE OR REPLACE FUNCTION notify_scouting_report_update(p_report uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_user  uuid;
  v_count int := 0;
BEGIN
  PERFORM _scouting_report_for_send(p_report, v_uid);
  FOR v_user IN SELECT a.user_id FROM _scouting_report_audience(p_report) a LOOP
    PERFORM _notify_scouting_report(p_report, v_user, true);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_scouting_report_update(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION notify_scouting_report_update(uuid) FROM PUBLIC, anon;

-- The owner's view of one report's delivery:
-- {clips, targets:[{teamId, userId, name, sentAt}], readers:[{userId, name,
-- role, teamName, openedAt, lastOpenedAt, watched}]}. Readers are everyone the
-- report reaches, read or not; watched counts the clips still in the report.
CREATE OR REPLACE FUNCTION get_scouting_report_delivery(p_report uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row scouting_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM scouting_reports WHERE id = p_report AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  RETURN jsonb_build_object(
    'clips', cardinality(v_row.clip_keys),
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'teamId', rr.team_id,
               'userId', rr.user_id,
               'name', COALESCE(t.name, NULLIF(trim(pr.full_name), ''), 'Member'),
               'sentAt', rr.sent_at
             ) ORDER BY rr.team_id IS NULL, COALESCE(t.name, pr.full_name))
        FROM scouting_report_recipients rr
        LEFT JOIN teams t ON t.id = rr.team_id
        LEFT JOIN profiles pr ON pr.id = rr.user_id
       WHERE rr.report_id = p_report
    ), '[]'::jsonb),
    'readers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'userId', a.user_id,
               'name', COALESCE(NULLIF(trim(pr.full_name), ''), 'Member'),
               'role', a.role,
               'teamName', t.name,
               'openedAt', rd.opened_at,
               'lastOpenedAt', rd.last_opened_at,
               'watched', COALESCE(cardinality(ARRAY(
                  SELECT unnest(rd.watched_clip_keys) INTERSECT SELECT unnest(v_row.clip_keys)
               )), 0)
             ) ORDER BY pr.full_name)
        FROM _scouting_report_audience(p_report) a
        LEFT JOIN profiles pr ON pr.id = a.user_id
        LEFT JOIN teams t ON t.id = a.team_id
        LEFT JOIN scouting_report_reads rd ON rd.report_id = p_report AND rd.user_id = a.user_id
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_scouting_report_delivery(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_scouting_report_delivery(uuid) FROM PUBLIC, anon;

-- For the Reports page: per live report of the caller's that was sent, how
-- many people it reaches and how many opened it.
CREATE OR REPLACE FUNCTION get_my_scouting_report_reach()
RETURNS TABLE (report_id uuid, reached int, opened int)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id,
         (SELECT count(*)::int FROM _scouting_report_audience(r.id)),
         (SELECT count(*)::int FROM _scouting_report_audience(r.id) a
            JOIN scouting_report_reads rd ON rd.report_id = r.id AND rd.user_id = a.user_id)
    FROM scouting_reports r
   WHERE r.user_id = auth.uid()
     AND r.revoked_at IS NULL
     AND r.expires_at > now()
     AND EXISTS (SELECT 1 FROM scouting_report_recipients rr WHERE rr.report_id = r.id);
$$;

GRANT EXECUTE ON FUNCTION get_my_scouting_report_reach() TO authenticated;
REVOKE EXECUTE ON FUNCTION get_my_scouting_report_reach() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. The player: what reached me, and recording what I read
-- ---------------------------------------------------------------------------
-- The live reports that reach the caller, newest sent first. game is the
-- content's header.game ({at, home}) or null; clips counts the report's clip
-- files and watched_keys holds those of them the caller has watched.
CREATE OR REPLACE FUNCTION get_my_scouting_reports()
RETURNS TABLE (
  id          uuid,
  title       text,
  opponent    text,
  game        jsonb,
  players     int,
  clips       int,
  sent_at     timestamptz,
  updated_at  timestamptz,
  expires_at  timestamptz,
  sender_name text,
  team_name   text,
  opened_at   timestamptz,
  watched_keys text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  WITH routes AS (
    SELECT rr.report_id, rr.sent_at, NULL::uuid AS team_id
      FROM scouting_report_recipients rr
     WHERE rr.user_id = auth.uid()
    UNION ALL
    SELECT rr.report_id, rr.sent_at, rr.team_id
      FROM scouting_report_recipients rr
      JOIN team_members tm ON tm.team_id = rr.team_id AND tm.user_id = auth.uid()
  ),
  mine AS (
    SELECT report_id,
           min(sent_at) AS sent_at,
           (array_agg(team_id ORDER BY sent_at) FILTER (WHERE team_id IS NOT NULL))[1] AS team_id
      FROM routes
     GROUP BY report_id
  )
  SELECT r.id,
         r.title,
         NULLIF(trim(r.content->'header'->>'opponent'), ''),
         CASE WHEN jsonb_typeof(r.content->'header'->'game') = 'object' THEN r.content->'header'->'game' END,
         COALESCE((SELECT count(*)::int FROM jsonb_array_elements(r.content->'sections') s WHERE s->>'kind' = 'player'), 0),
         cardinality(r.clip_keys),
         m.sent_at,
         r.updated_at,
         r.expires_at,
         NULLIF(trim(pr.full_name), ''),
         t.name,
         rd.opened_at,
         COALESCE(ARRAY(
           SELECT unnest(rd.watched_clip_keys) INTERSECT SELECT unnest(r.clip_keys)
         ), '{}')
    FROM mine m
    JOIN scouting_reports r ON r.id = m.report_id
    LEFT JOIN profiles pr ON pr.id = r.user_id
    LEFT JOIN teams t ON t.id = m.team_id
    LEFT JOIN scouting_report_reads rd ON rd.report_id = r.id AND rd.user_id = auth.uid()
   WHERE r.revoked_at IS NULL
     AND r.expires_at > now()
     AND r.user_id <> auth.uid()
     AND EXISTS (
       SELECT 1 FROM org_memberships om
        WHERE om.user_id = auth.uid() AND om.org_id = _playlist_club_org(r.playlist_id)
     )
   ORDER BY m.sent_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_my_scouting_reports() TO authenticated;
REVOKE EXECUTE ON FUNCTION get_my_scouting_reports() FROM PUBLIC, anon;

-- The app calls this when the caller opens a report they were sent
-- (p_clip_key null) and when they finish watching one of its clips. A key the
-- report doesn't hold is ignored; a report that doesn't reach the caller, or
-- isn't live, raises not_recipient.
CREATE OR REPLACE FUNCTION record_scouting_report_read(p_report uuid, p_clip_key text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row scouting_reports%ROWTYPE;
  v_key text;
BEGIN
  SELECT * INTO v_row FROM scouting_reports WHERE id = p_report;
  IF NOT FOUND
     OR v_row.revoked_at IS NOT NULL
     OR v_row.expires_at <= now()
     OR NOT EXISTS (SELECT 1 FROM _scouting_report_audience(p_report) a WHERE a.user_id = v_uid) THEN
    RAISE EXCEPTION 'not_recipient';
  END IF;

  v_key := CASE WHEN p_clip_key = ANY (v_row.clip_keys) THEN p_clip_key END;

  INSERT INTO scouting_report_reads AS rd (report_id, user_id, watched_clip_keys)
  VALUES (p_report, v_uid, CASE WHEN v_key IS NULL THEN '{}'::text[] ELSE ARRAY[v_key] END)
  ON CONFLICT (report_id, user_id) DO UPDATE
     SET last_opened_at = now(),
         watched_clip_keys = CASE
           WHEN v_key IS NULL OR v_key = ANY (rd.watched_clip_keys) THEN rd.watched_clip_keys
           ELSE array_append(rd.watched_clip_keys, v_key)
         END;
END;
$$;

GRANT EXECUTE ON FUNCTION record_scouting_report_read(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION record_scouting_report_read(uuid, text) FROM PUBLIC, anon;
