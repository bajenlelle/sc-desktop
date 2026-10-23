-- =============================================================================
-- Player passes: Rookie's monthly subscription becomes one-time purchases
--
-- Leonard, 2026-10-17 (founder/pricing-strategy.md). A player buys a single
-- game (129 kr, any game) or a season pass (799 kr, every game of one team in
-- one season). Rookie stays a valid tier for legacy subscribers and review
-- accounts but is no longer sold. The free trial drops from 3 games to 2 for
-- accounts created from app_config.free_games_two_since (set at go-live);
-- older accounts keep 3.
--
-- import_log becomes the per-game access ledger. `via` records what paid for
-- each logged game, so trial and single slots are counted from it and season
-- pass games never are:
--   trial        a free trial slot (incl. free-refill grants)
--   single       a bought single game
--   season_pass  covered by a season pass (season_pass_id says which)
--   plan         Rookie, Pro or Franchise
--   exempt       a national-team game in a national-team space
--
-- Purchases are written only by the service role (the Stripe webhook in
-- apps/web) or by a platform admin. Dormant until app_config
-- player_pass_enabled = 'true': nothing can be bought before that. The season
-- pass has its own switch, season_pass_enabled, off since 2026-10-23: players
-- buy single games or go Pro, and the pass stays dormant (tables, functions
-- and any existing pass keep working) until it returns for youth parents.
--
-- Also closes two quota holes that start to cost money once games are paid:
--   * a saved game's source_game_id could be rewritten into another game (an
--     upsert of an existing row never re-runs the import trigger);
--   * an import could name any org, so a Free user could import into a
--     Franchise org's unlimited tier.
-- The national-team exemption now needs a national-team space as well.
--
-- _game_access is the single source of truth for the import decision;
-- _import_allowance summarises it for the meters. packages/shared/lib
-- plan-tier.ts and player-access.ts mirror the numbers for display.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Purchases and season passes
-- ---------------------------------------------------------------------------
CREATE TABLE purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                        text NOT NULL CHECK (kind IN ('single_game', 'season_pass')),
  quantity                    integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 50),
  amount_total                integer NOT NULL DEFAULT 0 CHECK (amount_total >= 0),  -- öre, VAT included
  currency                    text NOT NULL DEFAULT 'sek',
  source                      text NOT NULL CHECK (source IN ('stripe', 'admin')),
  status                      text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  receipt_url                 text,
  game_key                    text,             -- the game the purchase started from, if any
  note                        text,             -- admin grants: why
  created_by                  uuid,             -- admin grants: who
  created_at                  timestamptz NOT NULL DEFAULT now(),
  refunded_at                 timestamptz,
  CHECK ((source = 'stripe') = (stripe_checkout_session_id IS NOT NULL))
);

CREATE INDEX purchases_user_id_idx ON purchases (user_id);
CREATE INDEX purchases_payment_intent_idx ON purchases (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
-- Own rows only; written by the service role and platform-admin RPCs.
CREATE POLICY purchases_own_read ON purchases
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE TABLE season_passes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_id         uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  season_id           text NOT NULL,             -- '2026-27': the Genius CATALOG / league_team_sources id
  league_team_id      uuid NOT NULL REFERENCES league_teams(id),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded')),
  moves_used          integer NOT NULL DEFAULT 0 CHECK (moves_used >= 0),
  moved_from_team_id  uuid REFERENCES league_teams(id) ON DELETE SET NULL,
  moved_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- One live pass per user, season and team (a refunded pass can be bought again).
CREATE UNIQUE INDEX season_passes_one_active
  ON season_passes (user_id, season_id, league_team_id) WHERE status = 'active';
CREATE INDEX season_passes_purchase_id_idx ON season_passes (purchase_id);
CREATE INDEX season_passes_league_team_id_idx ON season_passes (league_team_id);

ALTER TABLE season_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY season_passes_own_read ON season_passes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Explicit privileges: the schema's default privileges would hand both tables
-- to anon and authenticated in full. Signed-in users only read (RLS keeps it
-- to their own rows); every write goes through the service role or a
-- SECURITY DEFINER function.
REVOKE ALL ON TABLE purchases, season_passes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE purchases, season_passes TO authenticated;
GRANT ALL ON TABLE purchases, season_passes TO service_role;

-- ---------------------------------------------------------------------------
-- 2. import_log records what paid for each game
-- ---------------------------------------------------------------------------
-- The import trigger always sets via; other direct writers (the probe
-- fixtures) get a trial game, which is what an unmarked import was.
ALTER TABLE import_log
  ADD COLUMN via text NOT NULL DEFAULT 'trial'
    CHECK (via IN ('trial', 'single', 'season_pass', 'plan', 'exempt')),
  ADD COLUMN season_pass_id uuid REFERENCES season_passes(id) ON DELETE SET NULL;

-- Backfill: national-team games never counted, games in paid spaces were paid
-- by the plan, and everything else was a trial game (the default).
UPDATE import_log SET via = 'exempt'
 WHERE league_id IN ('sweden-national-men', 'sweden-national-women');

UPDATE import_log il SET via = 'plan'
  FROM organizations o
 WHERE o.id = il.org_id
   AND o.plan_tier IN ('rookie', 'pro', 'franchise')
   AND il.via = 'trial';

-- ---------------------------------------------------------------------------
-- 3. Settings. free_games_two_since is left unset until go-live; while it is
--    unset every account gets 3 free games.
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value) VALUES
  ('player_pass_enabled', 'false'),
  ('season_pass_enabled', 'false'),
  ('season_pass_season', '2026-27')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers
-- ---------------------------------------------------------------------------

-- Free trial size: 2 games for accounts created from free_games_two_since,
-- 3 for older accounts (their copy promised 3). A value that isn't a date
-- counts as unset, so a typo in app_config can't fail every Free import.
CREATE OR REPLACE FUNCTION _free_trial_games(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since   timestamptz;
  v_created timestamptz;
BEGIN
  BEGIN
    SELECT value::timestamptz INTO v_since
      FROM app_config WHERE key = 'free_games_two_since';
  EXCEPTION WHEN data_exception THEN
    v_since := NULL;
  END;
  IF v_since IS NULL THEN
    RETURN 3;
  END IF;
  SELECT created_at INTO v_created FROM auth.users WHERE id = p_user;
  RETURN CASE WHEN v_created >= v_since THEN 2 ELSE 3 END;
END;
$$;

-- Single games a user has bought and not had refunded.
CREATE OR REPLACE FUNCTION _singles_bought(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity), 0)::int
    FROM purchases
   WHERE user_id = p_user AND kind = 'single_game' AND status = 'paid';
$$;

-- The season pass is on sale: sales are on and so is the pass itself.
CREATE OR REPLACE FUNCTION _season_pass_on()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM app_config WHERE key = 'player_pass_enabled'), 'false') = 'true'
     AND COALESCE((SELECT value FROM app_config WHERE key = 'season_pass_enabled'), 'false') = 'true';
$$;

-- The user has paid for something: a game or a pass, or a subscription at
-- some point (the scoutable.se webhook records it in stripe_customers). Any
-- purchase opens export for all of the user's games, so a Pro month does too.
CREATE OR REPLACE FUNCTION _has_paid(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM purchases WHERE user_id = p_user AND status = 'paid')
      OR EXISTS (SELECT 1 FROM stripe_customers sc
                   JOIN auth.users u ON lower(u.email) = lower(sc.email)
                  WHERE u.id = p_user AND sc.subscription_id IS NOT NULL);
$$;

-- The Genius team ids playing a game, read from the fixture cache (every
-- import fetches its game through the genius function, which caches the
-- fixture first). Empty for keys that aren't Genius match ids.
CREATE OR REPLACE FUNCTION _game_teams(p_game_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT c->>'teamId'), '{}')
    FROM genius_fixture_cache fc
   CROSS JOIN LATERAL jsonb_array_elements(fc.payload) f
   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f->'competitors', '[]'::jsonb)) c
   WHERE p_game_key ~ '^[0-9]+$'
     AND f->>'matchId' = p_game_key
     AND c->>'teamId' IS NOT NULL;
$$;

-- The user's live season pass that covers a game: one of the game's teams is
-- a source row of the pass's team in the pass's season. The season comes
-- from that row, never from the client-sent matches.season_id.
CREATE OR REPLACE FUNCTION _covering_season_pass(p_user uuid, p_game_key text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.id
    FROM season_passes sp
   WHERE sp.user_id = p_user
     AND sp.status = 'active'
     AND EXISTS (
       SELECT 1 FROM league_team_sources s
        WHERE s.source = 'genius'
          AND s.league_team_id = sp.league_team_id
          AND s.season_id = sp.season_id
          AND s.source_team_id = ANY (_game_teams(p_game_key)))
   ORDER BY sp.created_at
   LIMIT 1;
$$;

-- Free-tier usage. Trial slots are per space (as before); singles belong to
-- the user. Counted separately so an expired refill grant can never eat a
-- bought single.
CREATE OR REPLACE FUNCTION _free_usage(p_user uuid, p_org uuid)
RETURNS TABLE (trial_cap integer, trial_used integer, singles integer, single_used integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _free_trial_games(p_user)
      + (SELECT COALESCE(SUM(g.amount), 0)::int FROM import_grants g
          WHERE (g.user_id IS NULL OR g.user_id = p_user)
            AND g.starts_at <= now()
            AND (g.expires_at IS NULL OR g.expires_at > now())),
    (SELECT COUNT(*)::int FROM import_log il
      WHERE il.user_id = p_user
        AND (p_org IS NULL OR il.org_id = p_org)
        AND il.via = 'trial'),
    _singles_bought(p_user),
    (SELECT COUNT(*)::int FROM import_log il
      WHERE il.user_id = p_user AND il.via = 'single');
$$;

-- What would pay for a new game in this space. Always one row; via is NULL
-- when nothing does. Order on Free: season pass, trial slot, bought single.
CREATE OR REPLACE FUNCTION _game_access(p_user uuid, p_org uuid, p_game_key text, p_league_id text)
RETURNS TABLE (via text, season_pass_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Same values as NT_LEAGUE_IDS in packages/shared/lib/plan-tier.ts.
  v_nt    text[] := ARRAY['sweden-national-men', 'sweden-national-women'];
  v_tier  text;
  v_is_nt boolean;
  v_pass  uuid;
  v_used  integer;
  v_bonus integer;
  u       record;
BEGIN
  SELECT o.plan_tier, o.is_nt_org INTO v_tier, v_is_nt FROM organizations o WHERE o.id = p_org;
  v_tier := COALESCE(v_tier, 'free');

  -- National-team games in a national-team space never count.
  IF p_league_id = ANY (v_nt) AND COALESCE(v_is_nt, false) THEN
    RETURN QUERY SELECT 'exempt'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_tier IN ('pro', 'franchise') THEN
    RETURN QUERY SELECT 'plan'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_tier = 'rookie' THEN
    -- Legacy Rookie: 6 games a calendar month, plus grants.
    SELECT COUNT(*)::int INTO v_used FROM import_log il
     WHERE il.user_id = p_user
       AND (p_org IS NULL OR il.org_id = p_org)
       AND il.via <> 'exempt'
       AND il.created_at >= date_trunc('month', now());
    SELECT COALESCE(SUM(g.amount), 0)::int INTO v_bonus FROM import_grants g
     WHERE (g.user_id IS NULL OR g.user_id = p_user)
       AND g.starts_at <= now()
       AND (g.expires_at IS NULL OR g.expires_at > now());
    RETURN QUERY SELECT CASE WHEN v_used < 6 + v_bonus THEN 'plan' END::text, NULL::uuid;
    RETURN;
  END IF;

  v_pass := _covering_season_pass(p_user, p_game_key);
  IF v_pass IS NOT NULL THEN
    RETURN QUERY SELECT 'season_pass'::text, v_pass;
    RETURN;
  END IF;

  SELECT * INTO u FROM _free_usage(p_user, p_org);
  RETURN QUERY SELECT
    CASE
      WHEN u.trial_used < u.trial_cap THEN 'trial'
      WHEN u.single_used < u.singles THEN 'single'
    END::text,
    NULL::uuid;
END;
$$;

REVOKE EXECUTE ON FUNCTION _free_trial_games(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _singles_bought(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _season_pass_on() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _has_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _game_teams(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _covering_season_pass(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _free_usage(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _game_access(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The import gate. Same shape as before: a re-import of a logged game is
--    free, a demo game never counts, and a refused game raises
--    import_limit_reached (old desktop builds understand that token).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_match_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key  text := COALESCE(NEW.source_game_id, NEW.id);
  v_via  text;
  v_pass uuid;
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW;
  END IF;

  -- One import decision at a time per user, so two parallel imports can't
  -- both take the last slot.
  PERFORM pg_advisory_xact_lock(hashtextextended('import:' || NEW.user_id::text, 0));

  -- Re-import of an already-logged game is free: it was paid for once.
  IF EXISTS (SELECT 1 FROM import_log WHERE user_id = NEW.user_id AND game_key = v_key) THEN
    RETURN NEW;
  END IF;

  SELECT a.via, a.season_pass_id INTO v_via, v_pass
    FROM _game_access(NEW.user_id, NEW.org_id, v_key, NEW.league_id) a;
  IF v_via IS NULL THEN
    RAISE EXCEPTION 'import_limit_reached';
  END IF;

  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key, created_at, via, season_pass_id)
  VALUES (NEW.user_id, NEW.org_id, NEW.id, NEW.league_id, v_key, NEW.created_at, v_via, v_pass)
  ON CONFLICT (user_id, game_key) DO NOTHING;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 6. The meters (same return shape as before, for 0.7.x builds).
--    Free: base = trial games, bonus = grants + bought singles, used counts
--    trial and single games only, so remaining = trial slots left + singles
--    left. Season pass games never count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_allowance(p_user uuid, p_org uuid)
 RETURNS TABLE(tier text, win text, base_limit integer, bonus integer, used integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier   text;
  v_grants int;
  u        record;
BEGIN
  SELECT o.plan_tier INTO v_tier FROM organizations o WHERE o.id = p_org;
  v_tier := COALESCE(v_tier, 'free');

  SELECT COALESCE(SUM(g.amount), 0)::int INTO v_grants FROM import_grants g
   WHERE (g.user_id IS NULL OR g.user_id = p_user)
     AND g.starts_at <= now()
     AND (g.expires_at IS NULL OR g.expires_at > now());

  IF v_tier = 'free' THEN
    SELECT * INTO u FROM _free_usage(p_user, p_org);
    RETURN QUERY SELECT
      'free'::text,
      'lifetime'::text,
      u.trial_cap - v_grants,
      v_grants + u.singles,
      LEAST(u.trial_used, u.trial_cap) + u.single_used;
  ELSIF v_tier = 'rookie' THEN
    RETURN QUERY SELECT
      'rookie'::text,
      'month'::text,
      6,
      v_grants,
      (SELECT COUNT(*)::int FROM import_log il
        WHERE il.user_id = p_user
          AND (p_org IS NULL OR il.org_id = p_org)
          AND il.via <> 'exempt'
          AND il.created_at >= date_trunc('month', now()));
  ELSE
    RETURN QUERY SELECT
      v_tier,
      'unlimited'::text,
      NULL::int,
      v_grants,
      (SELECT COUNT(*)::int FROM import_log il
        WHERE il.user_id = p_user
          AND (p_org IS NULL OR il.org_id = p_org)
          AND il.via <> 'exempt');
  END IF;
END;
$function$;

-- A season pass for the season on sale has no count to show, so it reads as
-- no limit: a 0.7.x precheck never blocks a pass holder, and the import
-- trigger still decides game by game.
CREATE OR REPLACE FUNCTION get_import_quota(p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v       record;
  v_limit int;
  v_pass  boolean;
BEGIN
  SELECT * INTO v FROM _import_allowance(auth.uid(), p_org_id);
  v_pass := v.tier = 'free' AND EXISTS (
    SELECT 1 FROM season_passes sp
     WHERE sp.user_id = auth.uid()
       AND sp.status = 'active'
       AND sp.season_id = (SELECT value FROM app_config WHERE key = 'season_pass_season'));
  IF v.base_limit IS NULL OR v_pass THEN
    RETURN jsonb_build_object(
      'tier', v.tier, 'window', v.win, 'base_limit', NULL, 'bonus', v.bonus,
      'limit', NULL, 'used', v.used, 'remaining', NULL, 'has_pass', v_pass);
  END IF;
  v_limit := v.base_limit + v.bonus;
  RETURN jsonb_build_object(
    'tier', v.tier, 'window', v.win, 'base_limit', v.base_limit,
    'bonus', v.bonus, 'limit', v_limit, 'used', v.used,
    'remaining', GREATEST(0, v_limit - v.used), 'has_pass', false);
END;
$$;

GRANT EXECUTE ON FUNCTION get_import_quota(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Client reads
-- ---------------------------------------------------------------------------

-- What importing one game would use, for the import badges and precheck.
-- own_team: the game is one of "Your team"'s in this space. pass_available:
-- a season pass can be bought that would cover it (the pass is on sale, the
-- game is in the season on sale and no live pass for that team exists).
CREATE OR REPLACE FUNCTION check_game_access(p_org_id uuid, p_game_key text, p_league_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_logged   text;
  v_via      text;
  v_pass     uuid;
  v_team     uuid;
  v_season   text;
  v_on_sale  text;
  v_enabled  boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  SELECT value INTO v_on_sale FROM app_config WHERE key = 'season_pass_season';
  v_enabled := COALESCE((SELECT value FROM app_config WHERE key = 'player_pass_enabled'), 'false') = 'true';

  SELECT league_team_id INTO v_team FROM space_team_choices WHERE user_id = v_uid AND org_id = p_org_id;
  IF v_team IS NOT NULL THEN
    SELECT s.season_id INTO v_season FROM league_team_sources s
     WHERE s.source = 'genius'
       AND s.league_team_id = v_team
       AND s.source_team_id = ANY (_game_teams(p_game_key))
     LIMIT 1;
  END IF;

  SELECT il.via INTO v_logged FROM import_log il WHERE il.user_id = v_uid AND il.game_key = p_game_key;
  IF v_logged IS NOT NULL THEN
    v_via := v_logged;
  ELSE
    SELECT a.via, a.season_pass_id INTO v_via, v_pass
      FROM _game_access(v_uid, p_org_id, p_game_key, p_league_id) a;
  END IF;

  RETURN jsonb_build_object(
    'allowed',  v_via IS NOT NULL,
    'via',      v_via,
    'imported', v_logged IS NOT NULL,
    'own_team', v_season IS NOT NULL,
    'pass_team', (SELECT lt.name FROM season_passes sp JOIN league_teams lt ON lt.id = sp.league_team_id
                   WHERE sp.id = v_pass),
    'pass_available', _season_pass_on()
      AND v_season IS NOT NULL
      AND v_season = v_on_sale
      AND NOT EXISTS (SELECT 1 FROM season_passes sp
                       WHERE sp.user_id = v_uid AND sp.status = 'active'
                         AND sp.season_id = v_on_sale AND sp.league_team_id = v_team),
    'single_available', v_enabled
  );
END;
$$;

-- Everything the purchase sheet, profile card and meters need, for the
-- caller's personal space.
CREATE OR REPLACE FUNCTION get_my_player_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_team    uuid;
  v_on_sale text;
  v_enabled boolean;
  u         record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT o.id INTO v_org
    FROM org_memberships m JOIN organizations o ON o.id = m.org_id
   WHERE m.user_id = v_uid AND o.is_personal
   ORDER BY o.created_at
   LIMIT 1;

  SELECT value INTO v_on_sale FROM app_config WHERE key = 'season_pass_season';
  v_enabled := COALESCE((SELECT value FROM app_config WHERE key = 'player_pass_enabled'), 'false') = 'true';
  SELECT league_team_id INTO v_team FROM space_team_choices WHERE user_id = v_uid AND org_id = v_org;
  SELECT * INTO u FROM _free_usage(v_uid, v_org);

  RETURN jsonb_build_object(
    'enabled',         v_enabled,
    'pass_enabled',    _season_pass_on(),
    'season_on_sale',  v_on_sale,
    'personal_org_id', v_org,
    'has_paid',        _has_paid(v_uid),
    'trial_games',     u.trial_cap,
    'trial_left',      GREATEST(0, u.trial_cap - u.trial_used),
    'singles_left',    GREATEST(0, u.singles - u.single_used),
    'team', (
      SELECT jsonb_build_object(
        'id', lt.id,
        'name', lt.name,
        'league_name', lt.league_name,
        'in_season_on_sale', EXISTS (
          SELECT 1 FROM league_team_sources s
           WHERE s.source = 'genius' AND s.league_team_id = lt.id AND s.season_id = v_on_sale),
        -- Scheduled games this season (regular season, plus playoffs once drawn).
        'games_in_season', (
          SELECT COUNT(*)::int
            FROM genius_fixture_cache fc
           CROSS JOIN LATERAL jsonb_array_elements(fc.payload) f
           WHERE EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(f->'competitors', '[]'::jsonb)) c
              WHERE c->>'teamId' IN (
                SELECT s.source_team_id FROM league_team_sources s
                 WHERE s.source = 'genius' AND s.league_team_id = lt.id AND s.season_id = v_on_sale))))
        FROM league_teams lt WHERE lt.id = v_team),
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', sp.id,
               'season_id', sp.season_id,
               'team_id', sp.league_team_id,
               'team_name', lt.name,
               'league_name', lt.league_name,
               'moves_left', GREATEST(0, 1 - sp.moves_used),
               'status', sp.status,
               'created_at', sp.created_at) ORDER BY sp.created_at DESC)
        FROM season_passes sp JOIN league_teams lt ON lt.id = sp.league_team_id
       WHERE sp.user_id = v_uid), '[]'::jsonb),
    'purchases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id,
               'kind', p.kind,
               'quantity', p.quantity,
               'amount_total', p.amount_total,
               'currency', p.currency,
               'status', p.status,
               'source', p.source,
               'receipt_url', p.receipt_url,
               'created_at', p.created_at) ORDER BY p.created_at DESC)
        FROM purchases p WHERE p.user_id = v_uid), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Moving a season pass to another team: once per pass, to a team that
--    plays in the pass's season. Games already imported stay logged (free to
--    re-import); new games follow the new team.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION move_season_pass(p_pass_id uuid, p_league_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_pass season_passes;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_pass FROM season_passes WHERE id = p_pass_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_pass.status <> 'active' THEN RAISE EXCEPTION 'pass_not_active'; END IF;
  IF v_pass.league_team_id = p_league_team_id THEN RAISE EXCEPTION 'same_team'; END IF;
  IF v_pass.moves_used >= 1 THEN RAISE EXCEPTION 'no_moves_left'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM league_team_sources s
     WHERE s.source = 'genius' AND s.league_team_id = p_league_team_id AND s.season_id = v_pass.season_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_season';
  END IF;
  IF EXISTS (
    SELECT 1 FROM season_passes
     WHERE user_id = v_uid AND status = 'active'
       AND season_id = v_pass.season_id AND league_team_id = p_league_team_id
  ) THEN
    RAISE EXCEPTION 'already_have_pass';
  END IF;

  UPDATE season_passes
     SET league_team_id = p_league_team_id,
         moved_from_team_id = v_pass.league_team_id,
         moved_at = now(),
         moves_used = moves_used + 1
   WHERE id = p_pass_id;

  RETURN jsonb_build_object('moved', true, 'moves_left', 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION check_game_access(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_my_player_access() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION move_season_pass(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_game_access(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_player_access() TO authenticated;
GRANT EXECUTE ON FUNCTION move_season_pass(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Fulfilment and refunds (service role: the Stripe webhook and the
--    /purchase/complete page in apps/web). Fulfilment is idempotent on the
--    Checkout Session id, because Stripe may deliver an event more than once
--    and the landing page fulfils too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fulfill_player_purchase(
  p_checkout_session_id text,
  p_user_id             uuid,
  p_kind                text,
  p_quantity            integer,
  p_amount_total        integer,
  p_currency            text,
  p_payment_intent_id   text,
  p_receipt_url         text,
  p_season_id           text DEFAULT NULL,
  p_league_team_id      uuid DEFAULT NULL,
  p_game_key            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_purchase uuid;
  v_pass     uuid;
  v_team     text;
  v_app_url  text;
BEGIN
  IF p_kind NOT IN ('single_game', 'season_pass') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF p_kind = 'season_pass' AND (p_season_id IS NULL OR p_league_team_id IS NULL) THEN
    RAISE EXCEPTION 'pass_needs_team';
  END IF;
  -- A paid pass is fulfilled even while the pass is off: checkout stops new
  -- ones (apps/web player-checkout), and money taken must buy what it was for.

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase:' || p_checkout_session_id, 0));

  SELECT id INTO v_existing FROM purchases WHERE stripe_checkout_session_id = p_checkout_session_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('purchase_id', v_existing, 'already_fulfilled', true);
  END IF;

  INSERT INTO purchases (user_id, kind, quantity, amount_total, currency, source,
                         stripe_checkout_session_id, stripe_payment_intent_id, receipt_url, game_key)
  VALUES (p_user_id, p_kind, GREATEST(1, COALESCE(p_quantity, 1)), COALESCE(p_amount_total, 0),
          COALESCE(p_currency, 'sek'), 'stripe',
          p_checkout_session_id, p_payment_intent_id, p_receipt_url, p_game_key)
  RETURNING id INTO v_purchase;

  IF p_kind = 'season_pass' THEN
    INSERT INTO season_passes (user_id, purchase_id, season_id, league_team_id)
    VALUES (p_user_id, v_purchase, p_season_id, p_league_team_id)
    ON CONFLICT (user_id, season_id, league_team_id) WHERE status = 'active' DO NOTHING
    RETURNING id INTO v_pass;
    SELECT name INTO v_team FROM league_teams WHERE id = p_league_team_id;
  END IF;

  -- The confirmation must state that access started at once (the withdrawal
  -- waiver), so it is sent here, exactly once per purchase.
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  PERFORM _send_notification_email(
    _get_user_email(p_user_id),
    'player_purchase',
    jsonb_strip_nulls(jsonb_build_object(
      'kind',         p_kind,
      'quantity',     GREATEST(1, COALESCE(p_quantity, 1))::text,
      'amount',       (COALESCE(p_amount_total, 0) / 100)::text,   -- whole kronor
      'currency',     upper(COALESCE(p_currency, 'sek')),
      'team_name',    v_team,
      'season_label', CASE WHEN p_season_id IS NOT NULL THEN replace(p_season_id, '-', '/') END,
      'receipt_url',  p_receipt_url,
      'app_url',      COALESCE(v_app_url, 'https://app.scoutable.se')
    ))
  );

  RETURN jsonb_build_object(
    'purchase_id', v_purchase,
    'season_pass_id', v_pass,
    'already_fulfilled', false,
    -- A second pass for a team the user already holds: recorded, but needs a refund.
    'duplicate_pass', p_kind = 'season_pass' AND v_pass IS NULL
  );
END;
$$;

-- A full refund (charge.refunded with refunded = true). Partial refunds are
-- goodwill and leave the purchase in place.
CREATE OR REPLACE FUNCTION refund_player_purchase(p_payment_intent_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_user uuid;
  v_kind text;
BEGIN
  UPDATE purchases
     SET status = 'refunded', refunded_at = now()
   WHERE stripe_payment_intent_id = p_payment_intent_id AND status = 'paid'
  RETURNING id, user_id, kind INTO v_id, v_user, v_kind;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('refunded', false);
  END IF;
  UPDATE season_passes SET status = 'refunded' WHERE purchase_id = v_id;
  RETURN jsonb_build_object('refunded', true, 'purchase_id', v_id, 'user_id', v_user, 'kind', v_kind);
END;
$$;

REVOKE EXECUTE ON FUNCTION fulfill_player_purchase(text, uuid, text, integer, integer, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refund_player_purchase(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fulfill_player_purchase(text, uuid, text, integer, integer, text, text, text, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION refund_player_purchase(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Platform admin: grant, list and revoke (comps, support fixes, a second
--     team for a dual licence, App Store review accounts). Stripe purchases
--     are refunded in the Stripe Dashboard, which reaches the webhook.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_grant_player_purchase(
  p_email          text,
  p_kind           text,
  p_quantity       integer DEFAULT 1,
  p_league_team_id uuid DEFAULT NULL,
  p_season_id      text DEFAULT NULL,
  p_note           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_user     uuid;
  v_season   text;
  v_purchase uuid;
  v_pass     uuid;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_kind NOT IN ('single_game', 'season_pass') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF p_kind = 'season_pass' AND NOT _season_pass_on() THEN RAISE EXCEPTION 'pass_not_offered'; END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 50 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_user IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;

  IF p_kind = 'season_pass' THEN
    v_season := COALESCE(p_season_id, (SELECT value FROM app_config WHERE key = 'season_pass_season'));
    IF p_league_team_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM league_team_sources s
       WHERE s.source = 'genius' AND s.league_team_id = p_league_team_id AND s.season_id = v_season
    ) THEN
      RAISE EXCEPTION 'team_not_in_season';
    END IF;
    IF EXISTS (
      SELECT 1 FROM season_passes
       WHERE user_id = v_user AND status = 'active'
         AND season_id = v_season AND league_team_id = p_league_team_id
    ) THEN
      RAISE EXCEPTION 'already_have_pass';
    END IF;
  END IF;

  INSERT INTO purchases (user_id, kind, quantity, amount_total, source, note, created_by)
  VALUES (v_user, p_kind, CASE WHEN p_kind = 'season_pass' THEN 1 ELSE p_quantity END, 0,
          'admin', NULLIF(trim(COALESCE(p_note, '')), ''), v_uid)
  RETURNING id INTO v_purchase;

  IF p_kind = 'season_pass' THEN
    INSERT INTO season_passes (user_id, purchase_id, season_id, league_team_id)
    VALUES (v_user, v_purchase, v_season, p_league_team_id)
    RETURNING id INTO v_pass;
  END IF;

  RETURN jsonb_build_object('purchase_id', v_purchase, 'season_pass_id', v_pass);
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_player_purchases(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id           uuid,
  email        text,
  kind         text,
  quantity     integer,
  amount_total integer,
  currency     text,
  source       text,
  status       text,
  team_name    text,
  season_id    text,
  moves_used   integer,
  note         text,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN QUERY
    SELECT p.id, u.email::text, p.kind, p.quantity, p.amount_total, p.currency, p.source, p.status,
           lt.name, sp.season_id, sp.moves_used, p.note, p.created_at
      FROM purchases p
      JOIN auth.users u ON u.id = p.user_id
      LEFT JOIN season_passes sp ON sp.purchase_id = p.id
      LEFT JOIN league_teams lt ON lt.id = sp.league_team_id
     ORDER BY p.created_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;

-- Admin grants only. Marks the grant refunded, so its games stop being
-- covered from now on (games already imported stay).
CREATE OR REPLACE FUNCTION admin_revoke_player_purchase(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE purchases SET status = 'refunded', refunded_at = now()
   WHERE id = p_purchase_id AND source = 'admin' AND status = 'paid';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE season_passes SET status = 'refunded' WHERE purchase_id = p_purchase_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_grant_player_purchase(text, text, integer, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION admin_list_player_purchases(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION admin_revoke_player_purchase(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_grant_player_purchase(text, text, integer, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_list_player_purchases(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_revoke_player_purchase(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. Free refills skip anyone who has bought something: refills are for
--     people who haven't decided yet. Otherwise unchanged from 20261001120000.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _free_refill_rows()
RETURNS TABLE (
  user_id          uuid,
  email            text,
  full_name        text,
  declared_role    text,
  used             integer,
  allowance        integer,
  last_import_at   timestamptz,
  last_sign_in_at  timestamptz,
  in_club          boolean,
  had_subscription boolean,
  email_consent    boolean,
  will_email       boolean,
  last_refill_at   timestamptz,
  eligible_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM free_refill_settings WHERE id),
  p AS (
    SELECT om.user_id, o.id AS org_id
      FROM org_memberships om
      JOIN organizations o ON o.id = om.org_id
     WHERE o.is_personal
       AND COALESCE(o.plan_tier, 'free') = 'free'
       AND o.plan_tier_locked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.user_id = om.user_id AND pu.status = 'paid')
  ),
  ex AS (
    SELECT p.user_id, p.org_id, a.used, a.base_limit + a.bonus AS allowance
      FROM p, LATERAL _import_allowance(p.user_id, p.org_id) a
     WHERE a.used >= a.base_limit + a.bonus
  ),
  r AS (
    SELECT ex.*,
           (SELECT max(il.created_at) FROM import_log il
             WHERE il.user_id = ex.user_id AND il.org_id = ex.org_id) AS last_import_at,
           (SELECT max(fr.refilled_at) FROM free_refills fr
             WHERE fr.user_id = ex.user_id) AS last_refill_at
      FROM ex
  )
  SELECT r.user_id,
         u.email::text,
         pr.full_name,
         pr.declared_role,
         r.used,
         r.allowance,
         r.last_import_at,
         u.last_sign_in_at,
         EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                  WHERE m.user_id = r.user_id AND NOT o.is_personal),
         EXISTS (SELECT 1 FROM stripe_customers sc WHERE lower(sc.email) = lower(u.email)),
         COALESCE(ep.marketing_consent_at IS NOT NULL, false),
         -- Same rule as _marketing_unsubscribe_url, which the refill uses.
         COALESCE(ep.user_id IS NOT NULL AND ep.unsubscribed_at IS NULL
                  AND (NOT s.email_requires_consent OR ep.marketing_consent_at IS NOT NULL), false),
         r.last_refill_at,
         GREATEST(r.last_import_at + make_interval(days => s.wait_days),
                  r.last_refill_at + make_interval(days => s.cooldown_days))
    FROM r
    CROSS JOIN s
    JOIN auth.users u ON u.id = r.user_id
    LEFT JOIN profiles pr ON pr.id = r.user_id
    LEFT JOIN email_preferences ep ON ep.user_id = r.user_id
   WHERE NOT COALESCE(pr.is_platform_admin, false);
$$;

REVOKE EXECUTE ON FUNCTION _free_refill_rows() FROM PUBLIC, anon, authenticated;

-- The refill email's offer follows the sales switch: single games and the
-- season pass once player passes are on, Rookie and Pro before. Otherwise
-- unchanged from 20261001120000.
CREATE OR REPLACE FUNCTION refill_free_imports(p_user_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_set      free_refill_settings;
  v_row      record;
  v_expires  timestamptz;
  v_grant_id uuid;
  v_unsub    text;
  v_app_url  text;
  v_emailed  boolean := false;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  -- One refill at a time per user, so a double click can't grant twice.
  PERFORM pg_advisory_xact_lock(hashtextextended('free_refill:' || p_user_id::text, 0));

  SELECT * INTO v_set FROM free_refill_settings WHERE id;
  SELECT * INTO v_row FROM _free_refill_rows() f WHERE f.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_eligible';  -- not on free, plan locked, imports left, or a buyer
  END IF;

  IF NOT p_force AND v_row.eligible_at IS NOT NULL AND v_row.eligible_at > now() THEN
    IF v_row.last_refill_at IS NOT NULL
       AND v_row.last_refill_at + make_interval(days => v_set.cooldown_days) > now() THEN
      RAISE EXCEPTION 'refilled_recently';
    END IF;
    RAISE EXCEPTION 'too_soon';
  END IF;

  v_expires := now() + make_interval(days => v_set.expires_days);

  INSERT INTO import_grants (user_id, amount, reason, expires_at, created_by)
  VALUES (p_user_id, v_set.amount, 'free_refill', v_expires, v_uid)
  RETURNING id INTO v_grant_id;

  INSERT INTO free_refills (user_id, grant_id, amount, expires_at, refilled_by)
  VALUES (p_user_id, v_grant_id, v_set.amount, v_expires, v_uid);

  -- Marketing email: never after an unsubscribe, and only to opt-ins when the
  -- setting asks for consent. The helper returns NULL when not to send.
  v_unsub := _marketing_unsubscribe_url(p_user_id, v_set.email_requires_consent);
  IF v_unsub IS NOT NULL THEN
    SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
    PERFORM _send_notification_email(
      v_row.email,
      'free_refill',
      jsonb_strip_nulls(jsonb_build_object(
        'name',            NULLIF(split_part(COALESCE(v_row.full_name, ''), ' ', 1), ''),
        'amount',          v_set.amount::text,
        'expires_on',      to_char(v_expires AT TIME ZONE 'Europe/Stockholm', 'FMDD FMMonth YYYY'),
        'app_url',         COALESCE(v_app_url, 'https://app.scoutable.se'),
        'pricing_url',     'https://scoutable.se/pricing?utm_source=email&utm_medium=lifecycle&utm_campaign=free_refill',
        'unsubscribe_url', v_unsub,
        'offer',           CASE WHEN (SELECT value FROM app_config WHERE key = 'player_pass_enabled') = 'true'
                                THEN 'passes' END
      ))
    );
    UPDATE free_refills SET emailed_at = now()
     WHERE grant_id = v_grant_id;
    v_emailed := true;
  END IF;

  RETURN jsonb_build_object('granted', v_set.amount, 'expires_at', v_expires, 'emailed', v_emailed);
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Hardening
-- ---------------------------------------------------------------------------

-- A saved game can't become another game. saveMatch re-sends the same
-- source_game_id on every re-save; a legacy row without one may get it once.
CREATE OR REPLACE FUNCTION guard_match_game_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.source_game_id IS NOT NULL AND NEW.source_game_id IS DISTINCT FROM OLD.source_game_id THEN
    RAISE EXCEPTION 'game_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_match_game_identity ON matches;
CREATE TRIGGER trg_guard_match_game_identity
  BEFORE UPDATE OF source_game_id ON matches
  FOR EACH ROW EXECUTE FUNCTION guard_match_game_identity();

-- New imports go into the importer's personal space, or a club or
-- national-team space where they coach or administer (as the import page
-- already requires). The quota follows the target space's plan, so an
-- arbitrary org id would borrow someone else's unlimited tier.
CREATE OR REPLACE FUNCTION enforce_import_space()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role, demo copies and space-less legacy saves pass. A re-save of
  -- an existing match re-inserts it (upsert); only new imports are checked.
  IF auth.uid() IS NULL OR NEW.is_demo OR NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM matches WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = NEW.user_id
       AND m.org_id = NEW.org_id
       AND (o.is_personal OR m.role IN ('admin', 'coach'))
  ) AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_allowed_to_import';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_import_space ON matches;
CREATE TRIGGER trg_enforce_import_space
  BEFORE INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION enforce_import_space();

REVOKE EXECUTE ON FUNCTION guard_match_game_identity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION enforce_import_space() FROM PUBLIC, anon, authenticated;
