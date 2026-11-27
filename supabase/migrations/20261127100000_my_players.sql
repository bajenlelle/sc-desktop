-- My player: which roster player an account is, so the desktop's Highlights page knows which plays are the
-- player's own in every game they import (2026-11-27, player highlights).
-- One row per account and data source: today only Genius, where `person_id` is the league feed's personId
-- (`league_players.source_person_id`, `play_by_play_events.player.playerId`). It belongs to the person, not to a
-- space, so it follows the player into every space. The player sets it once and can change it.
-- `name` and `number` are what the player picked, kept for the UI; the feed stays the truth for each game's
-- shirt number. Access is RLS only, like filter_presets (20261112110000): the owner's alone.

CREATE TABLE my_players (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source     text NOT NULL DEFAULT 'genius' CHECK (source IN ('genius')),
  person_id  text NOT NULL CHECK (person_id ~ '^[0-9]{1,12}$'),
  name       text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  number     text CHECK (number ~ '^[0-9]{1,3}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source)
);

-- The owner's alone. auth.uid() once per query.
ALTER TABLE my_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_players_owner ON my_players
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- The apps read and write the owner's row; anon never touches the table.
-- TRUNCATE isn't subject to RLS, so the default grant of it goes too.
GRANT SELECT, INSERT, UPDATE, DELETE ON my_players TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON my_players FROM authenticated;
REVOKE ALL ON my_players FROM anon;
