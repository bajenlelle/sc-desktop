-- =============================================================================
-- Performance hygiene for the cloud game video and scouting report tables
-- =============================================================================
-- Found in the 2026-10-21 performance audit of feat/cloud-game-videos. None of
-- this is on the playlists read path (no read-path policy touches these
-- tables); it keeps the new tables to the rules 20260904100000 set for small,
-- frequently read ones.
--
-- 1. Planner statistics. Autovacuum analyzes a table after 50 rows + 10% have
--    changed, which a table of a few dozen rows rarely reaches: on sc-staging
--    scouting_reports and media_deletions had never been analyzed. The apps
--    list game_videos on every web page and poll render_jobs every 2-3 s
--    while a job runs. Same overrides as 20260904100000's small tables.
-- 2. scouting_reports_owner_read evaluated auth.uid() once per row; the
--    (SELECT auth.uid()) form is an InitPlan evaluated once per query, like
--    every other owner policy.
-- 3. _media_key_referenced asked `p_key = ANY (r.clip_keys)`, which can't use
--    scouting_reports_clip_keys_idx (GIN); `clip_keys @> ARRAY[p_key]` can.
--    Same answer. Re-created from 20261024100000.
-- =============================================================================

-- 1. Statistics for the small, frequently read tables -------------------------
ALTER TABLE game_videos          SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                      autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE render_jobs          SET (autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.02,
                                      autovacuum_vacuum_threshold   = 20, autovacuum_vacuum_scale_factor  = 0.05);
ALTER TABLE scouting_reports     SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                      autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE media_deletions      SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                      autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);
ALTER TABLE game_video_deletions SET (autovacuum_analyze_threshold = 5,  autovacuum_analyze_scale_factor = 0.0,
                                      autovacuum_vacuum_threshold   = 10, autovacuum_vacuum_scale_factor  = 0.0);

ANALYZE game_videos;
ANALYZE render_jobs;
ANALYZE scouting_reports;
ANALYZE media_deletions;
ANALYZE game_video_deletions;

-- 2. The owner policy reads auth.uid() once per query -------------------------
ALTER POLICY scouting_reports_owner_read ON scouting_reports
  USING (user_id = (SELECT auth.uid()));

-- 3. The live-report check uses the GIN index ---------------------------------
CREATE OR REPLACE FUNCTION _media_key_referenced(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM playlist_clips c
            WHERE c.r2_url IS NOT NULL
              AND right(c.r2_url, length(p_key) + 1) = '/' || p_key)
      OR EXISTS (
           SELECT 1 FROM render_jobs j
            WHERE j.kind = 'ship'
              AND j.status IN ('queued', 'running')
              AND jsonb_typeof(j.params->'clips') = 'array'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(j.params->'clips') e WHERE e->>'key' = p_key))
      OR EXISTS (
           SELECT 1 FROM scouting_reports r
            WHERE r.revoked_at IS NULL
              AND r.expires_at > now()
              AND r.clip_keys @> ARRAY[p_key]);
$$;
REVOKE ALL ON FUNCTION _media_key_referenced(text) FROM PUBLIC, anon, authenticated;
