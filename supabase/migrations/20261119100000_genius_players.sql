-- League players: Genius rosters with photos, for scouting reports and later
-- player features.
--
-- The `genius` edge function fills these from
-- GET /competitions/{c}/teams/{t}/persons (one call per team) in the weekly
-- season audit and through the platform-admin `sync_rosters` action. Photos are
-- copied into the media bucket (R2) under
-- players/genius/<personId>/<hash>-{T1,S1,M1,L1}.jpg (75/200/400/600 px);
-- photo_key holds the S1 key and the other sizes swap the suffix. The hash is
-- Genius's own image hash, so a new photo gets a new key and old URLs never
-- change under a published report.
--
-- source_person_id is the same Genius personId the play-by-play and report
-- drafts carry, so a report player's photo is one lookup away.
--
-- Access: signed-in users read the public columns only (names, number,
-- photo). Birth date, height, weight and nationality are stored for future
-- features and stay service-role only until a feature grants exactly what it
-- needs. Writes are service-role only (no write policies, no write grants).

CREATE TABLE league_players (
  source               text NOT NULL,                  -- genius, …
  source_person_id     text NOT NULL,                  -- the source's person id, stable across seasons
  first_name           text NOT NULL DEFAULT '',
  family_name          text NOT NULL DEFAULT '',
  default_shirt_number text,
  playing_position     text,
  dob                  date,
  height_cm            integer,
  weight_kg            integer,
  nationality          text,
  nationality_code     text,
  photo_key            text,                           -- R2 key of the S1 (200 px) photo; NULL = none (yet)
  photo_source         text,                           -- the source's image hash photo_key was copied from
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_person_id)
);

ALTER TABLE league_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY league_players_read ON league_players FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE league_players FROM PUBLIC, anon, authenticated;
GRANT SELECT (source, source_person_id, first_name, family_name, default_shirt_number, photo_key)
  ON TABLE league_players TO authenticated;
GRANT ALL ON TABLE league_players TO service_role;

-- Who played for which team in which season (a player can appear for two
-- teams in one season).
CREATE TABLE league_player_teams (
  source           text NOT NULL,
  source_person_id text NOT NULL,
  source_team_id   text NOT NULL,                      -- = league_team_sources.source_team_id (one season)
  league_team_id   uuid REFERENCES league_teams(id) ON DELETE SET NULL,
  league_id        text NOT NULL,
  season_id        text NOT NULL,
  shirt_number     text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_person_id, source_team_id),
  FOREIGN KEY (source, source_person_id) REFERENCES league_players (source, source_person_id) ON DELETE CASCADE
);

CREATE INDEX league_player_teams_team_idx ON league_player_teams (source, source_team_id);
CREATE INDEX league_player_teams_league_team_idx ON league_player_teams (league_team_id);

ALTER TABLE league_player_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY league_player_teams_read ON league_player_teams FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE league_player_teams FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE league_player_teams TO authenticated;
GRANT ALL ON TABLE league_player_teams TO service_role;

-- Convention gap: the cron helper predates the rule that internal SECURITY
-- DEFINER helpers are not callable by clients.
REVOKE ALL ON FUNCTION run_genius_season_audit() FROM PUBLIC, anon, authenticated;
