-- The genius function's `season` answer per competition: every game's
-- per-team totals from Genius's teammatch statistics, joined with the fixture
-- list, and the standings (packages/shared/lib/season-payload.ts). The desktop
-- Stats view compares a game with each team's season from it
-- (docs/superpowers/specs/2026-11-20-season-context-design.md).
--
-- Refreshed after 12 hours, on the first request; served stale when Genius
-- fails. Server-written only: RLS enabled with no policies, so only the
-- service role (the genius function) reads and writes it.

CREATE TABLE IF NOT EXISTS genius_season_cache (
  competition_id bigint PRIMARY KEY,        -- a Genius competition IS a league-season
  payload        jsonb NOT NULL,            -- SeasonPayload: { games, standings, fetchedAt }
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE genius_season_cache ENABLE ROW LEVEL SECURITY;

-- A handful of rows rewritten on every refresh, like genius_fixture_cache.
ALTER TABLE genius_season_cache SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                     autovacuum_vacuum_threshold  = 10, autovacuum_vacuum_scale_factor  = 0.0);
