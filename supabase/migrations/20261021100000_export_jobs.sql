-- Cloud game videos, milestone 3b: export jobs (the server export).
--
-- render_jobs (20261020100000) gains its second kind. An export renders one
-- MP4 of a playlist (or of a selection of its items) from the owner's cloud
-- copies, with the desktop's fades, letterbox (16:9) or pan (9:16), cards and
-- wordmark, for one of two purposes (request->>'purpose'):
--   download  a file in the PRIVATE game-video bucket at
--             <prefix>/exports/<userId>/<jobId>.mp4, saved by the owner through
--             a presigned link (the function's export_link) and kept 7 days
--             (EXPORT_KEEP_DAYS in packages/shared/lib/game-video-wire.ts);
--   share     a highlight link: a highlight_shares row the function inserts at
--             render_done, its files highlights/<uid>/<shareId>.mp4|jpg in the
--             PUBLIC media bucket, which that bucket's lifecycle rule cleans
--             (as for the desktop's Send to phone).
--
-- 1. phase: where a running export is (clips → stitch → upload), for the
--    editor's "Exporting · clip 3 of 8" / "Joining…" / "Uploading…".
-- 2. One live job per (playlist, kind, aspect, purpose): a download and a share
--    of the same aspect may run together; a second request of either kind of
--    the same aspect coalesces into the live one.
-- 3. _export_tier_for_playlist: the plan an export is gated (free: no export)
--    and watermarked (rookie: always) by: the playlist's club, or the owner's
--    personal space for a playlist outside any.
-- 4. A download's file follows its row: whenever the row goes (the retention
--    below, or a playlist or account deletion cascading into it), its key is
--    queued in game_video_deletions for the nightly purge. The key is
--    params->'keys'->>'video' (written at render_take, before the renderer is
--    handed a URL that can write it) and, once done, result->>'key' too; only
--    the row's own key shape is ever queued, so no other object can be.
-- 5. Retention: ship jobs and downloads a week after they finished (as before;
--    a download's file goes with it through 4), share jobs after 30 days,
--    the lifetime of their links (SHARE_LINK_DAYS).
-- Verified by supabase/tests/render_jobs.sh.

-- ---------------------------------------------------------------------------
-- 1. Where an export is
-- ---------------------------------------------------------------------------
ALTER TABLE render_jobs
  ADD COLUMN phase text CHECK (phase IS NULL OR phase IN ('clips', 'stitch', 'upload'));

-- ---------------------------------------------------------------------------
-- 2. One live job per playlist, kind, aspect and purpose
-- ---------------------------------------------------------------------------
-- Finer than the index it replaces (one more column), so the rows already
-- there satisfy it.
DROP INDEX IF EXISTS render_jobs_live_idx;
CREATE UNIQUE INDEX render_jobs_live_idx
  ON render_jobs (playlist_id, kind, (COALESCE(request->>'aspect', '')), (COALESCE(request->>'purpose', '')))
  WHERE status IN ('queued', 'running');

-- ---------------------------------------------------------------------------
-- 3. The plan an export is billed to
-- ---------------------------------------------------------------------------
-- The playlist's club's plan_tier; for a playlist outside any club (a
-- personal-space or legacy unscoped one), the owner's personal space's;
-- 'free' when neither is there. Called by the function (service role) only.
CREATE OR REPLACE FUNCTION _export_tier_for_playlist(p_playlist_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT o.plan_tier
       FROM playlists p
       JOIN organizations o ON o.id = p.org_id
      WHERE p.id = p_playlist_id),
    (SELECT o.plan_tier
       FROM playlists p
       JOIN org_memberships m ON m.user_id = p.user_id
       JOIN organizations o ON o.id = m.org_id AND o.is_personal
      WHERE p.id = p_playlist_id
      ORDER BY o.created_at
      LIMIT 1),
    'free');
$$;
REVOKE ALL ON FUNCTION _export_tier_for_playlist(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A download's file follows its row
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose, like queue_game_video_deletion: a playlist or
-- account delete runs as the user over PostgREST and cascades into this
-- trigger, and the user has no right to write the queue. The key must be
-- exactly this job's download key (<prefix>/exports/<user_id>/<id>.mp4): a
-- malformed params can never queue a game's copy or anyone else's file.
CREATE OR REPLACE FUNCTION queue_render_job_export_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF OLD.kind = 'export' AND OLD.request->>'purpose' = 'download' THEN
    v_key := COALESCE(OLD.params->'keys'->>'video', OLD.result->>'key');
    IF v_key ~ ('^[A-Za-z0-9_-]{1,64}/exports/' || OLD.user_id::text || '/' || OLD.id::text || '\.mp4$') THEN
      INSERT INTO game_video_deletions (storage_key, upload_id)
      VALUES (v_key, NULL)
      ON CONFLICT (storage_key) DO NOTHING;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION queue_render_job_export_deletion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_queue_render_job_export_deletion
  BEFORE DELETE ON render_jobs
  FOR EACH ROW EXECUTE FUNCTION queue_render_job_export_deletion();

-- ---------------------------------------------------------------------------
-- 5. Retention
-- ---------------------------------------------------------------------------
-- Re-created from 20261020100000. A download's row goes after 7 days and its
-- file with it (the trigger above queues the key as the row is deleted); a
-- share job's row after 30 days, when its link has expired (the files are the
-- media bucket's lifecycle rule's). Live jobs are never touched.
CREATE OR REPLACE FUNCTION _render_jobs_retention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM render_jobs
   WHERE status IN ('done', 'failed')
     AND COALESCE(finished_at, updated_at) < now() - CASE
           WHEN kind = 'export' AND request->>'purpose' = 'share' THEN interval '30 days'
           ELSE interval '7 days'
         END;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION _render_jobs_retention() FROM PUBLIC, anon, authenticated;
