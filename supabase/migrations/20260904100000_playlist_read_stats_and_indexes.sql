-- Playlist read path, phase 1: planner statistics + the indexes RLS probes.
--
-- Symptom: /playlists and /my-playlists slow on both apps. Measured on prod
-- with 63 matches / 115 playlists / 26,468 events — so not a volume problem:
--
--   * pg_stat_user_tables showed last_analyze = NEVER on every read-path
--     table, and last_autoanalyze = NEVER on playlist_shares,
--     playlist_user_shares, playlist_folders, team_members and clip_views.
--     Autovacuum's default trigger is 50 + 10% of rows, which a 3-row table
--     never reaches — so the planner had ZERO statistics for exactly the
--     tables every RLS policy scans.
--   * Consequence: EXPLAIN as `authenticated` estimated 1,153,048,122 rows
--     for a query returning 14, and picked nested loops accordingly.
--     playlist_shares (3 live rows) had taken 50,568 sequential scans /
--     556,955 tuples read; playlist_user_shares (3 rows) 49,239 / 377,637;
--     playlists (115 rows) 19,692 / 2,130,772.
--   * 20260831100000_ship_before_notify.sql added notified_at to both share
--     tables and then UPDATEd every row, which is why this tipped over in
--     the last days specifically: a full rewrite (3 live / 16 dead tuples)
--     on tables that had no statistics to begin with.
--
-- This migration is deliberately additive only — no policy, function or
-- index is dropped, and nothing here changes what any role can see. The RLS
-- restructuring that removes the per-row subplans is a separate migration.

-- ---------------------------------------------------------------------------
-- 1. Keep statistics fresh on the small, hot tables.
-- ---------------------------------------------------------------------------
-- scale_factor 0 + a low flat threshold makes autoanalyze track tables that
-- are tiny but read on every request, where the percentage-based default is
-- effectively never satisfied.

ALTER TABLE playlist_shares      SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                     autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE playlist_user_shares SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                     autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE playlist_folders     SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                     autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE team_members         SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                     autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE clip_views           SET (autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.02,
                                     autovacuum_vacuum_threshold   = 20, autovacuum_vacuum_scale_factor  = 0.05);
ALTER TABLE org_memberships      SET (autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.02,
                                     autovacuum_vacuum_threshold   = 20, autovacuum_vacuum_scale_factor  = 0.05);
ALTER TABLE playlists            SET (autovacuum_analyze_threshold = 20, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE playlist_clips       SET (autovacuum_analyze_threshold = 50, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE matches              SET (autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);

-- ---------------------------------------------------------------------------
-- 2. Indexes the read path needs.
-- ---------------------------------------------------------------------------

-- org_memberships.org_id: unindexed FK, and the PK (user_id, org_id) cannot
-- serve an org_id-leading lookup. Probed per row by the om_admin_read policy's
-- self-EXISTS, by current_user_org_peer_ids() (which feeds the profiles SELECT
-- policy), and by get_org_members(p_org_id) — called once per org context.
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships (org_id);

-- playlist_user_shares.shared_by: unindexed FK, and playlist_user_shares_owner
-- is USING (shared_by = auth.uid()) — evaluated inside the PLAYLIST_SELECT
-- embed on every playlist row, plus getMySharedOutPlaylists filters on it.
CREATE INDEX IF NOT EXISTS idx_playlist_user_shares_shared_by ON playlist_user_shares (shared_by);

-- getMyTeamPlaylists does .in("team_id", …).order("created_at", desc).
-- idx_playlists_team covers only the filter, leaving a separate sort.
-- (That partial index is now a prefix of this one; left in place so this
-- migration stays additive.)
CREATE INDEX IF NOT EXISTS idx_playlists_team_created
  ON playlists (team_id, created_at DESC) WHERE team_id IS NOT NULL;

-- listMatchesLight always orders by created_at desc; matches_org_id_idx
-- covers the org filter but not the ordering. Same prefix note as above.
CREATE INDEX IF NOT EXISTS idx_matches_org_created ON matches (org_id, created_at DESC);

-- clip_views.match_id: unindexed FK, so the ON DELETE CASCADE from matches
-- must sequentially scan. Deleting a match is a routine coach action.
CREATE INDEX IF NOT EXISTS idx_clip_views_match ON clip_views (match_id);

-- Cascade support for the two deletes that actually happen often — removing a
-- playlist and removing a match. The remaining unindexed FKs (labels.org_id,
-- feedback_reports.org_id, import_grants.user_id, org_invites.created_by /
-- team_id, team_invites.created_by, clip_label_assignments.org_id) only cascade
-- on org or account deletion, which is rare admin work; indexing them would
-- cost write throughput on every insert for no read-path gain.
CREATE INDEX IF NOT EXISTS idx_highlight_shares_playlist ON highlight_shares (playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_reminders_user ON playlist_reminders (user_id);
CREATE INDEX IF NOT EXISTS idx_cla_playlist ON clip_label_assignments (playlist_id)
  WHERE playlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cla_match ON clip_label_assignments (match_id);

-- ---------------------------------------------------------------------------
-- 3. Collect statistics now, so the fix lands with this migration rather than
--    whenever autovacuum next wakes up. ANALYZE is transaction-safe (VACUUM
--    is not, which is why it is absent here).
-- ---------------------------------------------------------------------------
ANALYZE playlists;
ANALYZE playlist_clips;
ANALYZE playlist_shares;
ANALYZE playlist_user_shares;
ANALYZE playlist_folders;
ANALYZE play_by_play_events;
ANALYZE matches;
ANALYZE clip_views;
ANALYZE org_memberships;
ANALYZE team_members;
ANALYZE profiles;
ANALYZE teams;
ANALYZE clip_label_assignments;
