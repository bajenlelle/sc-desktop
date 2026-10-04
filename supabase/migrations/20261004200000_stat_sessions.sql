-- Stat keeper ("Scoutable Stats"): games whose statistics a parent or player
-- recorded live on a phone, by voice or by tap, in leagues where the official
-- protocol only carries points, fouls and timeouts (Profixio district
-- basketball). Each event has a wall-clock `recorded_at`, so the desktop app
-- syncs them with game video exactly like Genius/Profixio play-by-play.
--
-- Flow: the phone owns a `stat_sessions` row and appends `stat_events`
-- (client-assigned `seq`, never reused; undo = `voided_at`, correction =
-- new row + `superseded_by`). Finalising publishes the session: every
-- signed-in user can then see it on that game in the desktop import
-- ("Stats available") and choose it over the official protocol. The import
-- itself still goes through the desktop's saveMatch into matches /
-- play_by_play_events, so RLS, license_locked, import_limit_reached and
-- import_log semantics are untouched; the match keeps the official
-- source_game_id and records which session it used in `stats_session_id`.
--
-- Visibility: owner writes; authenticated users read FINAL, unhidden
-- sessions and their events; raw utterances and confidences live in
-- stat_event_private, which only the owner can read. Anonymous reads nothing.
--
-- Additive: new tables, two nullable columns on matches, no changes to
-- existing policies or triggers.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stat_sessions (
  id              uuid PRIMARY KEY,                               -- minted on the phone (offline-first)
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_game_id  text,                                           -- official game id as the desktop stores it ("profixio:<id>" / Genius id); NULL = unlinked
  league_id       text,
  stage_id        text,
  home_name       text NOT NULL,
  away_name       text NOT NULL,
  our_side        smallint NOT NULL CHECK (our_side IN (1, 2)),   -- PlayByPlay teamNumber: 1 home, 2 away
  tracking_mode   text NOT NULL DEFAULT 'ours' CHECK (tracking_mode IN ('ours', 'both')),
  home_roster     jsonb NOT NULL DEFAULT '[]',                    -- [{jerseyNumber, playerName}] = matches.home_roster shape
  away_roster     jsonb NOT NULL DEFAULT '[]',
  game_date       date NOT NULL,
  tipoff_at       timestamptz,                                    -- the "Start Q1" tap = sync anchor
  period_count    smallint NOT NULL DEFAULT 4,
  status          text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'final')),
  finalized_at    timestamptz,
  revision        integer NOT NULL DEFAULT 0,                     -- bumped by finalize/reopen; matches.source_revision compares
  keeper_label    text NOT NULL DEFAULT 'Anonymous keeper',
  event_count     integer NOT NULL DEFAULT 0,                     -- current rows at finalize
  hidden_at       timestamptz,                                    -- platform-admin moderation
  capture_meta    jsonb NOT NULL DEFAULT '{}',                    -- {recognizer, latencyMs, app, platform}
  audio_url       text,                                           -- phase 2
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stat_sessions_public_game_idx
  ON stat_sessions (source_game_id)
  WHERE status = 'final' AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS stat_sessions_creator_idx
  ON stat_sessions (created_by, game_date DESC);

CREATE TABLE IF NOT EXISTS stat_events (
  session_id     uuid NOT NULL REFERENCES stat_sessions(id) ON DELETE CASCADE,
  seq            integer NOT NULL CHECK (seq > 0),               -- becomes PlayByPlayEvent.eventId
  client_id      text NOT NULL,                                  -- idempotency key for offline replay
  kind           text NOT NULL CHECK (kind IN ('2pt','3pt','freethrow','rebound','assist','steal','block','turnover','foul','foulon','timeout','period')),
  sub_type       text NOT NULL DEFAULT '',
  is_successful  smallint NOT NULL DEFAULT 1 CHECK (is_successful IN (0, 1)),
  team_side      smallint NOT NULL CHECK (team_side IN (1, 2)),
  jersey         text,                                           -- NULL for team events
  player_name    text,
  period         smallint NOT NULL CHECK (period >= 1),
  recorded_at    timestamptz NOT NULL,                           -- the keeper's time for the play
  source         text NOT NULL CHECK (source IN ('live', 'tap', 'batch', 'manual')),
  linked_seq     integer,                                        -- assist → its shot
  voided_at      timestamptz,                                    -- undo; the row is kept
  superseded_by  integer,                                        -- seq of the correcting row
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seq),
  UNIQUE (session_id, client_id)
);

CREATE INDEX IF NOT EXISTS stat_events_session_time_idx ON stat_events (session_id, recorded_at);

-- Owner-only companion: what was heard and how sure the recogniser was.
CREATE TABLE IF NOT EXISTS stat_event_private (
  session_id     uuid NOT NULL REFERENCES stat_sessions(id) ON DELETE CASCADE,
  seq            integer NOT NULL,
  raw_utterance  text NOT NULL DEFAULT '',
  confidence     real,
  PRIMARY KEY (session_id, seq)
);

-- Which session an imported match's events came from (NULL = the league feed)
-- and that session's revision at import time.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stats_session_id uuid REFERENCES stat_sessions(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS source_revision integer;

CREATE OR REPLACE FUNCTION stat_sessions_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stat_sessions_touch_updated_at ON stat_sessions;
CREATE TRIGGER stat_sessions_touch_updated_at
  BEFORE UPDATE ON stat_sessions
  FOR EACH ROW EXECUTE FUNCTION stat_sessions_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE stat_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stat_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stat_event_private ENABLE ROW LEVEL SECURITY;

/** Sessions the caller keeps. */
CREATE OR REPLACE FUNCTION current_user_owned_stat_session_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM stat_sessions WHERE created_by = (SELECT auth.uid());
$$;

/** Own sessions plus everyone's finalised, unhidden ones (the community layer). */
CREATE OR REPLACE FUNCTION current_user_visible_stat_session_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM stat_sessions
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND (created_by = (SELECT auth.uid()) OR (status = 'final' AND hidden_at IS NULL));
$$;

GRANT EXECUTE ON FUNCTION current_user_owned_stat_session_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_visible_stat_session_ids() TO authenticated;

DROP POLICY IF EXISTS stat_sessions_owner ON stat_sessions;
CREATE POLICY stat_sessions_owner ON stat_sessions FOR ALL TO authenticated
  USING (created_by = (SELECT auth.uid()))
  WITH CHECK (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS stat_sessions_public_read ON stat_sessions;
CREATE POLICY stat_sessions_public_read ON stat_sessions FOR SELECT TO authenticated
  USING (status = 'final' AND hidden_at IS NULL);

DROP POLICY IF EXISTS stat_events_owner ON stat_events;
CREATE POLICY stat_events_owner ON stat_events FOR ALL TO authenticated
  USING (session_id IN (SELECT current_user_owned_stat_session_ids()))
  WITH CHECK (session_id IN (SELECT current_user_owned_stat_session_ids()));

DROP POLICY IF EXISTS stat_events_read ON stat_events;
CREATE POLICY stat_events_read ON stat_events FOR SELECT TO authenticated
  USING (session_id IN (SELECT current_user_visible_stat_session_ids()));

DROP POLICY IF EXISTS stat_event_private_owner ON stat_event_private;
CREATE POLICY stat_event_private_owner ON stat_event_private FOR ALL TO authenticated
  USING (session_id IN (SELECT current_user_owned_stat_session_ids()))
  WITH CHECK (session_id IN (SELECT current_user_owned_stat_session_ids()));

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

/**
 * The desktop schedule badge and source picker: finalised, unhidden sessions
 * for a page of game ids, newest first per game.
 */
CREATE OR REPLACE FUNCTION list_stat_sessions_for_games(p_game_ids text[])
RETURNS TABLE (
  source_game_id text,
  id uuid,
  keeper_label text,
  tracking_mode text,
  our_side smallint,
  event_count integer,
  has_tipoff boolean,
  finalized_at timestamptz,
  revision integer,
  home_name text,
  away_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.source_game_id, s.id, s.keeper_label, s.tracking_mode, s.our_side, s.event_count,
         s.tipoff_at IS NOT NULL, s.finalized_at, s.revision, s.home_name, s.away_name
    FROM stat_sessions s
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND s.status = 'final'
     AND s.hidden_at IS NULL
     AND s.source_game_id = ANY (p_game_ids)
   ORDER BY s.source_game_id, s.finalized_at DESC;
$$;

GRANT EXECUTE ON FUNCTION list_stat_sessions_for_games(text[]) TO authenticated;

/**
 * Publish a session. Requires a sync anchor (the tip-off tap or at least one
 * made basket for the keeper's team), counts the current events and bumps the
 * revision so an earlier desktop import can show "stats updated".
 */
CREATE OR REPLACE FUNCTION finalize_stat_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session stat_sessions%ROWTYPE;
  v_count integer;
  v_has_anchor boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_session FROM stat_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.created_by <> v_uid THEN RAISE EXCEPTION 'not_session_owner'; END IF;

  SELECT count(*) INTO v_count
    FROM stat_events e
   WHERE e.session_id = p_session_id
     AND e.voided_at IS NULL AND e.superseded_by IS NULL
     AND e.kind <> 'period';

  v_has_anchor := v_session.tipoff_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM stat_events e
     WHERE e.session_id = p_session_id
       AND e.voided_at IS NULL AND e.superseded_by IS NULL
       AND e.kind IN ('2pt', '3pt', 'freethrow') AND e.is_successful = 1
       AND e.team_side = v_session.our_side
  );
  IF NOT v_has_anchor THEN RAISE EXCEPTION 'tipoff_missing'; END IF;

  UPDATE stat_sessions
     SET status = 'final',
         finalized_at = now(),
         revision = revision + 1,
         event_count = v_count
   WHERE id = p_session_id
   RETURNING revision INTO v_session.revision;

  RETURN jsonb_build_object('revision', v_session.revision, 'event_count', v_count);
END;
$$;

/** Take a published session back to live for corrections. */
CREATE OR REPLACE FUNCTION reopen_stat_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_revision integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT created_by INTO v_owner FROM stat_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'not_session_owner'; END IF;

  UPDATE stat_sessions
     SET status = 'live', finalized_at = NULL, revision = revision + 1
   WHERE id = p_session_id
   RETURNING revision INTO v_revision;

  RETURN jsonb_build_object('revision', v_revision);
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_stat_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reopen_stat_session(uuid) TO authenticated;

-- Live box score for a game (phase 4): row-per-event writes and the SELECT
-- policy above are already shaped for it. Flip when needed:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.stat_events;
