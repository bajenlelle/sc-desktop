-- =============================================================================
-- Record which season and stage a match was imported from.
--
-- Until now the league list flattened league + season + game type into a
-- single id: "sbl-herr" and "sbl-herr-playoff" were separate "leagues" that
-- shared a seriesUuid, and the season was hardcoded into the schedule query
-- string. The app now models these separately (League -> Season -> Stage),
-- so matches record all three.
-- =============================================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS season_id text,
  ADD COLUMN IF NOT EXISTS stage_id  text;

-- ---------------------------------------------------------------------------
-- Backfill: fold the retired "*-playoff" league ids into their real league
-- plus a stage. These ids no longer exist in the app's league list, so
-- without this the affected matches would reference an unknown league.
-- ---------------------------------------------------------------------------
UPDATE matches SET league_id = 'sbl-herr',        stage_id = 'playoff'
  WHERE league_id = 'sbl-herr-playoff';
UPDATE matches SET league_id = 'sbl-dam',         stage_id = 'playoff'
  WHERE league_id = 'sbl-dam-playoff';
UPDATE matches SET league_id = 'superettan-herr', stage_id = 'playoff'
  WHERE league_id = 'superettan-herr-playoff';

-- Everything imported before this change came from the single hardcoded
-- seasonUuid (ye02q4jwit = 2025/26) and, unless retagged above, the regular
-- season. Only touch rows that actually came from a league import.
UPDATE matches SET season_id = '2025-26'
  WHERE season_id IS NULL AND league_id IS NOT NULL;
UPDATE matches SET stage_id = 'regular'
  WHERE stage_id IS NULL AND league_id IS NOT NULL;

-- Season-scoped lookups (match library filters, per-season import counts).
CREATE INDEX IF NOT EXISTS matches_league_season_idx
  ON matches (league_id, season_id);
