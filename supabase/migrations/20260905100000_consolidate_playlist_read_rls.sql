-- Playlist read path, phase 3: consolidate the RLS policies.
--
-- Measured on prod (63 matches / 115 playlists / 26,468 events), a single
-- authenticated read produced a 590-line plan with 166 SubPlan nodes, 48
-- InitPlans and auth.uid() inlined 132 times; planning alone took 16-27ms
-- against 0.8ms for the same query with RLS off. Two structural causes:
--
--   1. `playlists` and `playlist_clips` each carried FOUR permissive policies.
--      Permissive policies are OR'd, so every one is evaluated for every row.
--   2. Several were CORRELATED subqueries (they referenced the outer row), so
--      they ran per row instead of once — and because the tables they reach
--      into carry their own RLS, each evaluation dragged in that table's
--      policy set too. playlist_shares and playlist_user_shares, both THREE
--      ROWS, had taken 50,568 and 49,239 sequential scans respectively.
--
-- The fix is the pattern 20260430000003 already established here to break the
-- playlists <-> playlist_shares cycle: hoist the membership logic into STABLE
-- SECURITY DEFINER helpers. Definer rights stop the nested-RLS recursion, and
-- because the helpers are STABLE and uncorrelated the planner evaluates each
-- one ONCE as an InitPlan rather than per row.
--
-- This migration must not change who can see what. supabase/tests/
-- rls_playlist_equivalence.sh captures every fixture user's visible row set
-- before and after; the diff has to be empty.
--
-- It also fixes a latent defect found while building that harness: reading
-- `org_memberships` as `authenticated` raised "infinite recursion detected in
-- policy" because om_admin_read was a self-referential EXISTS on its own
-- table. Nothing hits it today (get_my_orgs / get_org_members are SECURITY
-- DEFINER; delete-account uses the service role), so the policy has never
-- actually worked. Same definer-helper treatment applies.

-- ---------------------------------------------------------------------------
-- 1. Definer helpers
-- ---------------------------------------------------------------------------

/** Playlists the caller owns. */
CREATE OR REPLACE FUNCTION current_user_owned_playlist_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM playlists WHERE user_id = (SELECT auth.uid());
$$;

/**
 * Every playlist the caller may READ, by any route: owned, bound to one of
 * their teams, shared to one of their teams, or shared to them directly.
 * These four branches are exactly the four policies this migration merges.
 */
CREATE OR REPLACE FUNCTION current_user_visible_playlist_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM playlists WHERE user_id = (SELECT auth.uid())
  UNION
  SELECT id FROM playlists
   WHERE team_id IS NOT NULL AND team_id IN (SELECT current_user_team_ids())
  UNION
  SELECT playlist_id FROM playlist_shares
   WHERE team_id IN (SELECT current_user_team_ids())
  UNION
  SELECT playlist_id FROM playlist_user_shares
   WHERE user_id = (SELECT auth.uid());
$$;

/**
 * (match_id, event_id) of every clip in a playlist the caller can read — the
 * set the events policy needs.
 *
 * NULL keys are excluded on purpose: the policy this replaces compared
 * `pc.event_id = play_by_play_events.event_id`, which yields NULL (not true)
 * for a NULL on either side, so such a clip never granted visibility. Dropping
 * the rows here keeps the row-wise IN below exactly equivalent.
 */
CREATE OR REPLACE FUNCTION current_user_visible_clip_keys()
RETURNS TABLE (match_id text, event_id bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pc.match_id, pc.event_id
    FROM playlist_clips pc
   WHERE pc.playlist_id IN (SELECT current_user_visible_playlist_ids())
     AND pc.match_id IS NOT NULL
     AND pc.event_id IS NOT NULL;
$$;

/** Matches the caller owns. */
CREATE OR REPLACE FUNCTION current_user_owned_match_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM matches WHERE user_id = (SELECT auth.uid());
$$;

/** Matches referenced by any playlist the caller can read. */
CREATE OR REPLACE FUNCTION current_user_visible_match_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT match_id FROM current_user_visible_clip_keys();
$$;

/** Orgs where the caller is an admin — replaces om_admin_read's self-EXISTS. */
CREATE OR REPLACE FUNCTION current_user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_memberships
   WHERE user_id = (SELECT auth.uid()) AND role = 'admin';
$$;

GRANT EXECUTE ON FUNCTION current_user_owned_playlist_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_visible_playlist_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_visible_clip_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_owned_match_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_visible_match_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_admin_org_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. playlists — 4 SELECT policies down to 2
-- ---------------------------------------------------------------------------
-- playlists_owner stays: `(SELECT auth.uid()) = user_id` is already an
-- InitPlan comparison and it carries the write path.
DROP POLICY IF EXISTS playlists_team_read ON playlists;
DROP POLICY IF EXISTS playlists_team_share_read ON playlists;
DROP POLICY IF EXISTS playlists_user_share_read ON playlists;

CREATE POLICY playlists_read ON playlists FOR SELECT
  USING (id IN (SELECT current_user_visible_playlist_ids()));

-- ---------------------------------------------------------------------------
-- 3. playlist_clips — 4 policies down to 1 SELECT + explicit writes
-- ---------------------------------------------------------------------------
-- Visibility here is exactly "clips of a playlist I can read", so all four
-- collapse. playlist_clips_owner was FOR ALL, so its write coverage has to be
-- restated — owner-only, as before.
DROP POLICY IF EXISTS playlist_clips_owner ON playlist_clips;
DROP POLICY IF EXISTS playlist_clips_team_read ON playlist_clips;
DROP POLICY IF EXISTS playlist_clips_shared_team_read ON playlist_clips;
DROP POLICY IF EXISTS playlist_clips_user_share_read ON playlist_clips;

CREATE POLICY playlist_clips_read ON playlist_clips FOR SELECT
  USING (playlist_id IN (SELECT current_user_visible_playlist_ids()));

CREATE POLICY playlist_clips_insert ON playlist_clips FOR INSERT
  WITH CHECK (playlist_id IN (SELECT current_user_owned_playlist_ids()));

CREATE POLICY playlist_clips_update ON playlist_clips FOR UPDATE
  USING (playlist_id IN (SELECT current_user_owned_playlist_ids()))
  WITH CHECK (playlist_id IN (SELECT current_user_owned_playlist_ids()));

CREATE POLICY playlist_clips_delete ON playlist_clips FOR DELETE
  USING (playlist_id IN (SELECT current_user_owned_playlist_ids()));

-- ---------------------------------------------------------------------------
-- 4. play_by_play_events — the biggest win
-- ---------------------------------------------------------------------------
-- Both old policies were correlated EXISTS, so both ran per event row, and
-- events is the largest table in the read path (26k rows). The replacement is
-- two hashed InitPlan set lookups.
--
-- events_owner was FOR ALL; its USING/CHECK was `EXISTS (SELECT 1 FROM matches
-- WHERE matches.id = match_id AND matches.user_id = (SELECT auth.uid()))`,
-- i.e. precisely "match_id is one of mine". Writes keep that, restated.
DROP POLICY IF EXISTS events_owner ON play_by_play_events;
DROP POLICY IF EXISTS events_team_playlist_read ON play_by_play_events;

CREATE POLICY events_read ON play_by_play_events FOR SELECT
  USING (
    match_id IN (SELECT current_user_owned_match_ids())
    OR (match_id, event_id) IN (
      SELECT match_id, event_id FROM current_user_visible_clip_keys()
    )
  );

CREATE POLICY events_insert ON play_by_play_events FOR INSERT
  WITH CHECK (match_id IN (SELECT current_user_owned_match_ids()));

CREATE POLICY events_update ON play_by_play_events FOR UPDATE
  USING (match_id IN (SELECT current_user_owned_match_ids()))
  WITH CHECK (match_id IN (SELECT current_user_owned_match_ids()));

CREATE POLICY events_delete ON play_by_play_events FOR DELETE
  USING (match_id IN (SELECT current_user_owned_match_ids()));

-- ---------------------------------------------------------------------------
-- 5. matches — drop the DISTINCT-over-a-joined-scan
-- ---------------------------------------------------------------------------
-- matches_owner stays (already InitPlan, carries writes). The old read policy
-- ran `SELECT DISTINCT pc.match_id FROM playlist_clips pc JOIN playlists p ...`
-- with both tables' RLS applied inside it.
--
-- The helper's set includes matches referenced by the caller's OWN playlists,
-- which the old policy's three branches excluded — but matches_owner already
-- granted exactly those, so the OR'd union is unchanged.
DROP POLICY IF EXISTS matches_team_playlist_read ON matches;

CREATE POLICY matches_read ON matches FOR SELECT
  USING (id IN (SELECT current_user_visible_match_ids()));

-- ---------------------------------------------------------------------------
-- 6. Share tables — wrap auth.uid(), stop re-entering playlists
-- ---------------------------------------------------------------------------
-- playlist_shares_owner subqueried `playlists` with a bare auth.uid(), so it
-- paid playlists' whole policy set per row. Same set via the definer helper.
DROP POLICY IF EXISTS playlist_shares_owner ON playlist_shares;
CREATE POLICY playlist_shares_owner ON playlist_shares FOR ALL
  USING (playlist_id IN (SELECT current_user_owned_playlist_ids()))
  WITH CHECK (playlist_id IN (SELECT current_user_owned_playlist_ids()));
-- playlist_shares_team_read already uses current_user_team_ids(); left as-is.

DROP POLICY IF EXISTS playlist_user_shares_owner ON playlist_user_shares;
CREATE POLICY playlist_user_shares_owner ON playlist_user_shares FOR ALL
  USING (shared_by = (SELECT auth.uid()))
  WITH CHECK (shared_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS playlist_user_shares_recipient ON playlist_user_shares;
CREATE POLICY playlist_user_shares_recipient ON playlist_user_shares FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. org_memberships — break the infinite recursion
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS om_admin_read ON org_memberships;
CREATE POLICY om_admin_read ON org_memberships FOR SELECT
  USING (org_id IN (SELECT current_user_admin_org_ids()));

-- ---------------------------------------------------------------------------
-- 8. Remaining per-row auth.uid()/auth.jwt() calls the linter flagged
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ud_self_read ON user_devices;
CREATE POLICY ud_self_read ON user_devices FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "own reports" ON feedback_reports;
CREATE POLICY "own reports" ON feedback_reports FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "users read own subscription" ON stripe_customers;
CREATE POLICY "users read own subscription" ON stripe_customers FOR SELECT
  USING (email = ((SELECT auth.jwt()) ->> 'email'));

-- Deliberately untouched: playlist_folders_owner, clip_views_own,
-- clip_views_owner_read, om_self_read, team_members_select_*, and the five
-- pre-existing definer helpers (current_user_team_ids,
-- current_user_team_playlist_ids, current_user_org_peer_ids,
-- current_user_org_id, is_platform_admin). They are already STABLE definer
-- functions or InitPlan comparisons, and they get hoisted once per statement —
-- editing security-critical code for no measurable gain is the wrong trade.

ANALYZE playlists;
ANALYZE playlist_clips;
ANALYZE play_by_play_events;
ANALYZE matches;
