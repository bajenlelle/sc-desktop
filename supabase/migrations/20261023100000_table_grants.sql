-- Explicit Data API grants for the tables of cloud game videos.
--
-- From 2026-10-30 Supabase stops granting API access to new tables in
-- "public" automatically (existing projects included), so a table made by a
-- migration needs its own GRANTs: without them supabase-js gets "permission
-- denied" before RLS is even asked, and the edge functions' service role loses
-- its access too. Granting what the old default gave is harmless before that
-- date. RLS stays the gate: the two tables the apps read have an owner SELECT
-- policy and no client write policy; the two queues have neither.

-- Read by the apps as the signed-in owner (RLS: own rows). Written only by the
-- edge function and the SECURITY DEFINER helpers.
GRANT SELECT ON game_videos TO authenticated;
GRANT SELECT ON render_jobs TO authenticated;

-- The edge functions (service role) read and write all four.
GRANT SELECT, INSERT, UPDATE, DELETE ON game_videos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON render_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON game_video_deletions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_deletions TO service_role;

-- Nothing for anon, no client writes on the two read tables (the old default
-- also granted those), and nothing at all for clients on the queues.
REVOKE ALL ON game_videos, render_jobs, game_video_deletions, media_deletions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON game_videos, render_jobs FROM authenticated;
REVOKE ALL ON game_video_deletions, media_deletions FROM authenticated;
