-- Profixio import: server-side fetch cache for the `profixio` edge function.
--
-- Swedish district basketball (SBBF's ten districts, U13 to Division 2) lives
-- on Profixio, not Genius Sports. A second provider function
-- (supabase/functions/profixio) mirrors the genius one: the desktop client
-- browses league -> category -> match through four actions, and every
-- upstream read is cached in the tables below. Upstream is read either from
-- Profixio's documented API (when the PROFIXIO_API_SECRET function secret is
-- set) or, until SBBF issues a token, from Profixio's public web pages. Both
-- paths write the same trimmed shapes (packages/shared/lib/profixio-wire.ts),
-- so a driver switch needs no migration and no client release.
--
-- Persistence of imported matches is unchanged: the desktop client still
-- writes matches / play_by_play_events itself, so RLS, license_locked,
-- import_limit_reached and import_log semantics apply exactly as before. A
-- Profixio match is recognisable by its namespaced source_game_id
-- ("profixio:<matchId>") and league_id ("profixio-<district>-<slug>").
-- Nothing here touches an existing table.
--
-- Identifiers, verified against live pages 2026-10-02:
--   - league_id     = Profixio "avdelning" id (public URL /app/leagueid{id});
--                     a NEW id every season; what clients address everything by
--   - tournament_id = Profixio "turnering" id, what the documented API keys
--                     matches on; learned from the public league page's
--                     Livewire state and kept here for the API driver
--   - category_id   = match category (e.g. 1172071 "Nivå 2A Herrar U19"),
--                     shared by the public site and the API's matchCategory
--   - match_id      = shared by the public site and the API
--
-- Setup required after deployment:
--   1. Deploy the function by name:
--        npx supabase functions deploy profixio
--      (never a bare deploy-all or --prune from a feature branch).
--   2. No secret is required for the public-page driver.
--   3. When SBBF issues an API token:
--        npx supabase secrets set PROFIXIO_API_SECRET=<token>
--      The function switches driver on its next cold start; cached rows stay
--      valid (same shapes). Document it in docs/maintenance.md (secrets map).

-- 1. Catalogue: one row per (district, season) ----------------------------------
-- Keyed per district-season so a slow cold crawl (ten districts, two seasons,
-- one page load plus one Livewire call each) persists progress row by row and
-- never has to finish inside one request.

CREATE TABLE IF NOT EXISTS profixio_catalog_cache (
  district_id   integer NOT NULL,            -- 746..755 (SBBF districts on profixio.com)
  season_id     integer NOT NULL,            -- Profixio season id (776 = 26/27, 763 = 25/26)
  district_name text    NOT NULL DEFAULT '',
  season_label  text    NOT NULL DEFAULT '', -- as Profixio shows it, "Säsongen 26/27"
  payload       jsonb   NOT NULL DEFAULT '[]', -- [{leagueId, name}] for that district-season
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (district_id, season_id)
);

-- 2. League detail: the ids the API needs + the category list -------------------

CREATE TABLE IF NOT EXISTS profixio_league_cache (
  league_id     bigint PRIMARY KEY,          -- avdelning id
  name          text   NOT NULL,
  district_id   integer,
  tournament_id bigint,                      -- turnering id; NULL until seen in page state / API
  season_id     bigint,
  categories    jsonb  NOT NULL DEFAULT '[]', -- [{categoryId, name, matchCount}]
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. Schedule per (league, category) ----------------------------------------------

CREATE TABLE IF NOT EXISTS profixio_schedule_cache (
  league_id   bigint  NOT NULL,
  category_id bigint  NOT NULL,
  payload     jsonb   NOT NULL DEFAULT '[]',  -- ProfixioScheduleRow[]
  partial     boolean NOT NULL DEFAULT false, -- lazy-loaded remainder could not be fetched
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, category_id)
);

-- 4. Match payloads ------------------------------------------------------------------
-- `final` rows are permanent (full time + a 3 h grace for the table crew's
-- corrections, see isFinal in profixio-wire.ts); everything else has a short
-- TTL in the function. `schema_version` lets a future change to the trimmed
-- shape invalidate old permanent rows without a manual DELETE.

CREATE TABLE IF NOT EXISTS profixio_match_cache (
  match_id       bigint PRIMARY KEY,
  league_id      bigint NOT NULL,
  category_id    bigint,
  payload        jsonb  NOT NULL,            -- ProfixioMatchResponse minus schedule/fetchedAt
  state          text   NOT NULL DEFAULT '', -- "full_time", "in_progress", "not_started", …
  final          boolean NOT NULL DEFAULT false,
  -- 'empty' is a negative cache: the match exists but carries no events
  -- (paper protocol, or not played yet). Short TTL while recent, permanent
  -- after a week.
  pbp_status     text   NOT NULL CHECK (pbp_status IN ('ok', 'empty')),
  source         text   NOT NULL CHECK (source IN ('public', 'api')),
  schema_version smallint NOT NULL DEFAULT 1,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profixio_match_cache_league_idx
  ON profixio_match_cache (league_id, category_id);

-- Server-written only: RLS enabled with no policies, so nothing but the
-- service role can touch them. Clients receive the data through the edge
-- function, never by reading these tables.
ALTER TABLE profixio_catalog_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profixio_league_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profixio_schedule_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE profixio_match_cache    ENABLE ROW LEVEL SECURITY;

-- Tiny, hot, rewritten on every TTL refresh — the shape default autoanalyze
-- (50 + 10%) never triggers on. Same settings as genius_fixture_cache.
ALTER TABLE profixio_catalog_cache  SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                         autovacuum_vacuum_threshold  = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE profixio_league_cache   SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                         autovacuum_vacuum_threshold  = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE profixio_schedule_cache SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                         autovacuum_vacuum_threshold  = 10, autovacuum_vacuum_scale_factor  = 0.0);
