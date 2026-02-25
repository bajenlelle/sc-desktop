-- =============================================================================
-- matches
-- =============================================================================
CREATE TABLE matches (
  id          text PRIMARY KEY,                    -- gameUuid from superettanherr.se
  user_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title       text NOT NULL,
  game_date   date,
  home_team   jsonb NOT NULL DEFAULT '{}',         -- {name, color}
  away_team   jsonb NOT NULL DEFAULT '{}',         -- {name, color}
  home_roster jsonb NOT NULL DEFAULT '[]',         -- [{jerseyNumber, playerName}]
  away_roster jsonb NOT NULL DEFAULT '[]',
  video_url   text,
  sync_point  jsonb,                               -- {syncVideoTime, syncRealWorldTime}
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Coach's match list: ordered by date
CREATE INDEX idx_matches_user_id ON matches (user_id, created_at DESC);

-- =============================================================================
-- play_by_play_events
-- =============================================================================
CREATE TABLE play_by_play_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id        text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_id        bigint,               -- ID from the API
  type            text NOT NULL,        -- "2pt", "3pt", "freethrow", etc.
  sub_type        text,
  period          smallint,
  game_clock_time text,
  real_world_time timestamptz,
  is_successful   smallint,             -- 1 = made, 0 = miss
  player          jsonb,                -- {playerId, pno, firstName, familyName, teamNumber}
  event_team      jsonb,                -- {teamCode, teamName, teamNumber}
  qualifiers      text[],
  UNIQUE (match_id, event_id)           -- idempotent re-imports
);

-- Primary access: all events for a match, optionally filtered by type or period
CREATE INDEX idx_pbp_match_type      ON play_by_play_events (match_id, type);
CREATE INDEX idx_pbp_match_period    ON play_by_play_events (match_id, period);
CREATE INDEX idx_pbp_real_world_time ON play_by_play_events (match_id, real_world_time);

-- =============================================================================
-- updated_at trigger
-- =============================================================================
CREATE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE matches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_by_play_events ENABLE ROW LEVEL SECURITY;

-- matches: owner-only
CREATE POLICY "matches_owner"
  ON matches FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- events: accessible only if the parent match belongs to the current user
CREATE POLICY "events_owner"
  ON play_by_play_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM matches
      WHERE matches.id = match_id
        AND matches.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM matches
      WHERE matches.id = match_id
        AND matches.user_id = (SELECT auth.uid())
    )
  );
