-- Team identity: the real-world team a user coaches or plays for, per space.
--
-- league_teams is Scoutable's own, source-agnostic record of a real team.
-- Sources hand out a fresh team id every season (Genius: BC Luleå is 186999 in
-- 2025/26 and 199014 in 2026/27) and names drift ("Alviks BBK" became
-- "Alviks Basketbollklubb"), so each season's source id is a row in
-- league_team_sources pointing at one stable league_teams row. A club id, where
-- the source has one, is stable and groups a club's teams (club_key), but club
-- plus gender is not unique: Jämtland fields two men's teams.
--
-- sync_league_teams (service role only; called by the `genius` edge function
-- after fixture refreshes, in the weekly audit and by the platform-admin
-- `sync_teams` action) keeps both tables current.
--
-- space_team_choices holds each user's answer per space (org): a team, an
-- "isn't listed" note, or neither (skipped). A row means the user was asked.
-- Users read their own rows; writes go through set_my_team. Leaving a space
-- deletes the choice with the membership.

CREATE TABLE league_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                                   -- newest season's name
  club_name   text,
  club_key    text,                                            -- '<source>:<club id>'; NULL when the source has no clubs
  gender      text CHECK (gender IN ('men', 'women')),
  league_id   text NOT NULL,                                   -- catalogue id of the newest league seen, e.g. superettan-herr
  league_name text NOT NULL,
  season_id   text NOT NULL,                                   -- newest season seen, e.g. 2026-27
  logo_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX league_teams_club_key_idx ON league_teams (club_key) WHERE club_key IS NOT NULL;

ALTER TABLE league_teams ENABLE ROW LEVEL SECURITY;
-- Public league data: any signed-in user may read it. Written by the service role only.
CREATE POLICY league_teams_read ON league_teams FOR SELECT TO authenticated USING (true);

CREATE TABLE league_team_sources (
  source          text NOT NULL,                               -- genius, …
  source_team_id  text NOT NULL,                               -- the source's id for the team in one season
  league_team_id  uuid NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  league_id       text NOT NULL,
  season_id       text NOT NULL,
  name_seen       text NOT NULL,
  logo_url        text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_team_id)
);

CREATE INDEX league_team_sources_league_team_id_idx ON league_team_sources (league_team_id);

ALTER TABLE league_team_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY league_team_sources_read ON league_team_sources FOR SELECT TO authenticated USING (true);

CREATE TABLE space_team_choices (
  user_id         uuid NOT NULL,
  org_id          uuid NOT NULL,
  league_team_id  uuid REFERENCES league_teams(id) ON DELETE SET NULL,
  unlisted_team   text CHECK (unlisted_team IS NULL OR char_length(unlisted_team) BETWEEN 1 AND 120),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id),
  FOREIGN KEY (user_id, org_id) REFERENCES org_memberships (user_id, org_id) ON DELETE CASCADE
);

CREATE INDEX space_team_choices_org_id_idx ON space_team_choices (org_id);
CREATE INDEX space_team_choices_league_team_id_idx ON space_team_choices (league_team_id);

ALTER TABLE space_team_choices ENABLE ROW LEVEL SECURITY;
-- Own rows only; writes go through set_my_team.
CREATE POLICY space_team_choices_own_read ON space_team_choices
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Upserts one source's teams for one league-season. p_teams is
-- [{ id, name, clubId?, clubName?, logoUrl? }]. A known source id updates in
-- place; a new one links to the club's team of the same gender that has no id
-- this season yet (the only one, or the one in the same league, or the one
-- with the same name), otherwise it starts a new team. Display fields follow
-- the newest season. Returns the number of teams written.
CREATE OR REPLACE FUNCTION sync_league_teams(
  p_source text,
  p_league_id text,
  p_league_name text,
  p_season_id text,
  p_gender text,
  p_teams jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t           jsonb;
  v_source_id text;
  v_name      text;
  v_club_key  text;
  v_club_name text;
  v_logo      text;
  v_team      uuid;
  v_n         int := 0;
BEGIN
  IF p_source IS NULL OR p_source !~ '^[a-z][a-z0-9_]*$' THEN RAISE EXCEPTION 'invalid_source'; END IF;
  IF NULLIF(btrim(p_league_id), '') IS NULL OR NULLIF(btrim(p_league_name), '') IS NULL
     OR NULLIF(btrim(p_season_id), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_league';
  END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('men', 'women') THEN RAISE EXCEPTION 'invalid_gender'; END IF;
  IF p_teams IS NULL OR jsonb_typeof(p_teams) <> 'array' THEN RAISE EXCEPTION 'invalid_teams'; END IF;

  FOR t IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_source_id := NULLIF(btrim(t->>'id'), '');
    v_name      := NULLIF(btrim(t->>'name'), '');
    CONTINUE WHEN v_source_id IS NULL OR v_name IS NULL;
    v_club_key  := CASE WHEN NULLIF(btrim(t->>'clubId'), '') IS NULL THEN NULL
                        ELSE p_source || ':' || btrim(t->>'clubId') END;
    v_club_name := NULLIF(btrim(t->>'clubName'), '');
    v_logo      := NULLIF(btrim(t->>'logoUrl'), '');
    v_team      := NULL;

    SELECT s.league_team_id INTO v_team
    FROM league_team_sources s
    WHERE s.source = p_source AND s.source_team_id = v_source_id;

    IF v_team IS NULL AND v_club_key IS NOT NULL THEN
      WITH cand AS (
        SELECT lt.id,
               (lt.league_id = p_league_id)        AS same_league,
               (lower(lt.name) = lower(v_name))    AS same_name
        FROM league_teams lt
        WHERE lt.club_key = v_club_key
          AND lt.gender IS NOT DISTINCT FROM p_gender
          AND NOT EXISTS (
            SELECT 1 FROM league_team_sources s
            WHERE s.league_team_id = lt.id AND s.source = p_source AND s.season_id = p_season_id
          )
      )
      SELECT c.id INTO v_team
      FROM cand c
      WHERE (SELECT count(*) FROM cand) = 1 OR c.same_league OR c.same_name
      ORDER BY c.same_league DESC, c.same_name DESC
      LIMIT 1;
    END IF;

    IF v_team IS NULL THEN
      INSERT INTO league_teams (name, club_name, club_key, gender, league_id, league_name, season_id, logo_url)
      VALUES (v_name, v_club_name, v_club_key, p_gender, p_league_id, p_league_name, p_season_id, v_logo)
      RETURNING id INTO v_team;
    ELSE
      UPDATE league_teams
         SET name        = v_name,
             club_name   = COALESCE(v_club_name, club_name),
             league_id   = p_league_id,
             league_name = p_league_name,
             season_id   = p_season_id,
             logo_url    = COALESCE(v_logo, logo_url),
             updated_at  = now()
       WHERE id = v_team AND season_id <= p_season_id;
    END IF;

    INSERT INTO league_team_sources (source, source_team_id, league_team_id, league_id, season_id, name_seen, logo_url)
    VALUES (p_source, v_source_id, v_team, p_league_id, p_season_id, v_name, v_logo)
    ON CONFLICT (source, source_team_id) DO UPDATE
      SET league_id  = EXCLUDED.league_id,
          season_id  = EXCLUDED.season_id,
          name_seen  = EXCLUDED.name_seen,
          logo_url   = COALESCE(EXCLUDED.logo_url, league_team_sources.logo_url),
          updated_at = now();

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION sync_league_teams(text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_league_teams(text, text, text, text, text, jsonb) TO service_role;

-- Records the caller's team for one or more of their spaces. A team, an
-- "isn't listed" note, or neither (skipped) — each counts as answered.
CREATE OR REPLACE FUNCTION set_my_team(
  p_org_ids uuid[],
  p_league_team_id uuid DEFAULT NULL,
  p_unlisted_team text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_unlisted text := NULLIF(btrim(p_unlisted_team), '');
  v_n        int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_org_ids IS NULL OR cardinality(p_org_ids) = 0 OR cardinality(p_org_ids) > 50 THEN
    RAISE EXCEPTION 'invalid_spaces';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_org_ids) AS o(id)
    WHERE o.id IS NULL
       OR NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = v_uid AND m.org_id = o.id)
  ) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  IF p_league_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM league_teams WHERE id = p_league_team_id) THEN
    RAISE EXCEPTION 'unknown_team';
  END IF;
  IF v_unlisted IS NOT NULL AND char_length(v_unlisted) > 120 THEN RAISE EXCEPTION 'unlisted_team_too_long'; END IF;
  -- A picked team and an "isn't listed" note are alternatives.
  IF p_league_team_id IS NOT NULL THEN v_unlisted := NULL; END IF;

  INSERT INTO space_team_choices (user_id, org_id, league_team_id, unlisted_team)
  SELECT DISTINCT v_uid, o.id, p_league_team_id, v_unlisted
  FROM unnest(p_org_ids) AS o(id)
  ON CONFLICT (user_id, org_id) DO UPDATE
    SET league_team_id = EXCLUDED.league_team_id,
        unlisted_team  = EXCLUDED.unlisted_team,
        updated_at     = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION set_my_team(uuid[], uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_my_team(uuid[], uuid, text) TO authenticated;

-- Teams to list first in a club space: every team of each club that members
-- of the space picked, plus picked teams from sources without clubs. Teams
-- only, never who picked them. Empty for personal spaces.
CREATE OR REPLACE FUNCTION get_space_team_suggestions(p_org_id uuid)
RETURNS SETOF league_teams
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = v_uid AND m.org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT DISTINCT lt.id, lt.club_key
    FROM space_team_choices c
    JOIN organizations o ON o.id = c.org_id AND NOT o.is_personal
    JOIN league_teams lt ON lt.id = c.league_team_id
    WHERE c.org_id = p_org_id
  )
  SELECT lt.*
  FROM league_teams lt
  WHERE lt.id IN (SELECT p.id FROM picked p)
     OR lt.club_key IN (SELECT p.club_key FROM picked p WHERE p.club_key IS NOT NULL)
  ORDER BY lt.league_name, lt.name;
END;
$$;

REVOKE ALL ON FUNCTION get_space_team_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_space_team_suggestions(uuid) TO authenticated;
