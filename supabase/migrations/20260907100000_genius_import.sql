-- Genius Sports import: richer play-by-play columns + server-side fetch cache.
--
-- Match data moves from client-side scraping of the league sites
-- (sblherr.se / sbldam.se / superettanherr.se) to the official Genius Sports
-- Warehouse REST API — the same upstream data one hop closer (the scraped
-- feed's own `source` field reads "genius-basketball-stream-reader"). Genius
-- requires all calls to go through our backend with caching, so a new edge
-- function (supabase/functions/genius) proxies the two read shapes and caches
-- them in the tables below. Persistence of imported matches is unchanged:
-- the desktop client still writes matches / play_by_play_events itself, so
-- RLS, the license_locked and import_limit_reached triggers, and import_log
-- semantics all apply exactly as before.
--
-- The Genius feed carries fields the scrape never exposed. The new columns
-- are all nullable, so existing rows, readers, and the (match_id, event_id)
-- unique constraint are untouched. Verified against live data 2026-09-02:
--   - score1/score2 are home/away (final action matched the fixture result)
--   - playersTeam1/playersTeam2 are home/away (starters' teamIds checked)
--   - OT periods reset to 1 with periodType OVERTIME (global = 4 + period)
--   - actionNumber is monotonic across a whole match incl. OT (no collisions)
--   - shotClock exists in the feed but is all zeros so far — column is
--     schema-ready, no feature should depend on it yet
--
-- Setup required after deployment:
--   1. Deploy the genius Edge Function (supabase/functions/genius/).
--   2. Set the Edge Function secret in the Supabase dashboard:
--        GENIUS_API_KEY = <key from Genius Sports onboarding>
--   3. Remove GENIUS_API_KEY from apps/desktop/.env.prod — the key must only
--      ever live server-side (and must never gain a VITE_ prefix).

-- 1. Richer play-by-play fields ----------------------------------------------

ALTER TABLE play_by_play_events
  ADD COLUMN IF NOT EXISTS x               smallint,   -- shot coords, 0-100 court space (shots only)
  ADD COLUMN IF NOT EXISTS y               smallint,
  ADD COLUMN IF NOT EXISTS area            text,       -- named zone: 'underbasket', 'outsideleftwing', ...
  ADD COLUMN IF NOT EXISTS shot_clock      text,       -- 'MM:SS:cc'; all zeros in the feed so far
  ADD COLUMN IF NOT EXISTS previous_action bigint,     -- actionNumber this one follows (assist -> shot)
  ADD COLUMN IF NOT EXISTS on_court_home   bigint[],   -- Genius personIds on court at this action
  ADD COLUMN IF NOT EXISTS on_court_away   bigint[],
  ADD COLUMN IF NOT EXISTS score_home      smallint,   -- running score at this action
  ADD COLUMN IF NOT EXISTS score_away      smallint;

-- 2. Fetch cache for the genius edge function --------------------------------
-- Server-written only: RLS enabled with no policies, so nothing but the
-- service role can touch them. Clients receive the data through the edge
-- function, never by reading these tables.

CREATE TABLE IF NOT EXISTS genius_fixture_cache (
  competition_id bigint PRIMARY KEY,        -- a Genius competition IS a league-season
  payload        jsonb NOT NULL,            -- raw /competitions/{id}/matches data array
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS genius_match_cache (
  genius_match_id bigint PRIMARY KEY,
  competition_id  bigint NOT NULL,
  actions         jsonb NOT NULL DEFAULT '[]',  -- raw /matches/{id}/actions, all pages concatenated
  players         jsonb NOT NULL DEFAULT '[]',  -- raw /matches/{id}/players
  -- 'empty' is a negative cache: the match exists but carries no play-by-play
  -- (statsSource empty upstream). Without it every retry would re-spend quota
  -- on a permanently empty match.
  pbp_status      text  NOT NULL CHECK (pbp_status IN ('ok', 'empty')),
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE genius_fixture_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE genius_match_cache   ENABLE ROW LEVEL SECURITY;

-- genius_fixture_cache is a handful of rows rewritten on every TTL refresh —
-- exactly the tiny-hot shape that never trips default autoanalyze (50 + 10%).
ALTER TABLE genius_fixture_cache SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                      autovacuum_vacuum_threshold  = 10, autovacuum_vacuum_scale_factor  = 0.0);
