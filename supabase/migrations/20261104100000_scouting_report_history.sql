-- Scouting reports: an ended report stays in the coach's Reports list.
--
-- The daily sweep (20261029100000) deleted a report a week after it expired
-- or was stopped. The desktop's Reports page lists ended reports with their
-- last open count and a Share again, so the sweep now keeps the row and only
-- empties it: the content and clip keys go (the clip files queued for the
-- purge, as before), the title, dates and open_count stay. The public page
-- already answers expired or revoked before it reads any content.
--
-- A report whose playlist was deleted (playlist_id null) has nowhere to be
-- listed or shared again from: it is still deleted a week after it ended.
--
-- Safe to run again.

CREATE OR REPLACE FUNCTION run_scouting_report_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swept   integer;
  v_deleted integer;
BEGIN
  -- Ended a week ago and not yet emptied: queue the clip files, empty the row.
  PERFORM _queue_media_deletion(k, 'cleared')
     FROM (SELECT unnest(clip_keys) AS k
             FROM scouting_reports
            WHERE (expires_at < now() - interval '7 days'
                   OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days'))
              AND (content <> '{}'::jsonb OR clip_keys <> '{}')) q;
  UPDATE scouting_reports
     SET content = '{}'::jsonb, clip_keys = '{}'
   WHERE (expires_at < now() - interval '7 days'
          OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days'))
     AND (content <> '{}'::jsonb OR clip_keys <> '{}');
  GET DIAGNOSTICS v_swept = ROW_COUNT;

  -- Ended a week ago with its playlist gone: nothing lists it anymore.
  DELETE FROM scouting_reports
   WHERE playlist_id IS NULL
     AND (expires_at < now() - interval '7 days'
          OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days'));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_swept + v_deleted;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[scouting-report] run_scouting_report_sweep failed: %', SQLERRM;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION run_scouting_report_sweep() FROM PUBLIC, anon, authenticated;
