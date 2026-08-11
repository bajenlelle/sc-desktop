-- =============================================================================
-- Free re-imports of the same game.
--
-- matches.id is a fresh crypto.randomUUID() per import, so the import_log's
-- (user_id, match_id) uniqueness never deduplicated a delete + re-import —
-- the same game charged a second slot. Store the league API's stable game
-- uuid on the match and key the log on it instead. Pre-existing rows never
-- captured the uuid, so dedup applies to imports from now on.
-- =============================================================================

ALTER TABLE matches ADD COLUMN source_game_id text;

ALTER TABLE import_log ADD COLUMN game_key text;
UPDATE import_log SET game_key = match_id;
ALTER TABLE import_log ALTER COLUMN game_key SET NOT NULL;
ALTER TABLE import_log DROP CONSTRAINT import_log_user_id_match_id_key;
ALTER TABLE import_log ADD CONSTRAINT import_log_user_game_key UNIQUE (user_id, game_key);

-- Fall back to the row id for anything without a source uuid (manual or
-- legacy imports) — those keep the old per-row semantics.
CREATE OR REPLACE FUNCTION log_match_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.is_demo THEN
    INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key, created_at)
    VALUES (NEW.user_id, NEW.org_id, NEW.id, NEW.league_id,
            COALESCE(NEW.source_game_id, NEW.id), NEW.created_at)
    ON CONFLICT (user_id, game_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
