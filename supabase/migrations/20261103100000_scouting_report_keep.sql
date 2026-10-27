-- Scouting reports: a kept report never expires.
--
-- Scoutable's own sample report (the one scoutable.se's "See an example"
-- opens) has to outlive the 30 days every shared report gets. A kept report
-- has expires_at pinned to infinity by a trigger, so nothing else needs to
-- know about it: get_scouting_report (expires_at < now() is false), the open
-- counter and the free plan's one-report check (expires_at > now() is true)
-- and the sweep (expires_at < now() - 7 days is false) all leave it alone,
-- and the fresh 30 days Update link writes (publish_scouting_report's ON
-- CONFLICT) is overridden by the trigger. Stop sharing works as for any
-- report: the revoke wipes the content and the sweep deletes the row a week
-- later, kept or not.
--
-- Set from the SQL editor, as the service role (docs/scouting-reports.md):
--   SELECT _keep_scouting_report('<id>', true);   -- 'kept'
--   SELECT _keep_scouting_report('<id>', false);  -- 'released': a fresh 30 days
--
-- Every statement is safe to run again.

ALTER TABLE scouting_reports ADD COLUMN IF NOT EXISTS kept boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN scouting_reports.kept IS
  'Scoutable''s own sample report: never expires (expires_at is pinned to infinity by scouting_reports_keep_expiry). Set with _keep_scouting_report.';

-- Pins expires_at while the row is kept, whatever the writer set.
CREATE OR REPLACE FUNCTION _scouting_report_keep_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kept THEN
    NEW.expires_at := 'infinity';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION _scouting_report_keep_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS scouting_reports_keep_expiry ON scouting_reports;
CREATE TRIGGER scouting_reports_keep_expiry
  BEFORE INSERT OR UPDATE ON scouting_reports
  FOR EACH ROW EXECUTE FUNCTION _scouting_report_keep_expiry();

-- Keeps a live report (p_keep) or releases it to a fresh 30 days. Returns
-- 'kept', 'released', 'already_off' (it was stopped before) or 'not_found'.
-- updated_at is left alone: it is the report's "up to date", and keeping
-- changes nothing a reader sees.
CREATE OR REPLACE FUNCTION _keep_scouting_report(p_id uuid, p_keep boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revoked timestamptz;
BEGIN
  SELECT revoked_at INTO v_revoked
    FROM scouting_reports
   WHERE id = p_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_revoked IS NOT NULL THEN
    RETURN 'already_off';
  END IF;

  IF p_keep THEN
    UPDATE scouting_reports SET kept = true WHERE id = p_id;   -- the trigger pins expires_at
    RETURN 'kept';
  END IF;

  UPDATE scouting_reports
     SET kept = false, expires_at = now() + interval '30 days'
   WHERE id = p_id;
  RETURN 'released';
END;
$$;

REVOKE ALL ON FUNCTION _keep_scouting_report(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _keep_scouting_report(uuid, boolean) TO service_role;
