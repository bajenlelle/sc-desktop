-- ============================================================================
-- Weekly league-catalogue audit
--
-- Rolling a league to the next season is manual, and SBF publishes the new
-- competitions at unpredictable times — the 2026/27 Basketettan ids appeared
-- weeks after the SBL and Superettan ones. Until a coach noticed, that league
-- simply showed no games for two weeks.
--
-- This pokes the `genius` function every Monday; it compares its CATALOG
-- against upstream and files a GitHub issue (labelled `season-audit`, deduped
-- against any still-open one) when a season is missing or a configured
-- competition has no fixtures. claude-triage then picks the issue up like any
-- other, so it lands in the weekly sweep in docs/maintenance.md.
--
-- Setup, both required or the job no-ops silently:
--   1. Function secret:  npx supabase secrets set SEASON_AUDIT_SECRET=<value>
--   2. Same value in SQL: INSERT INTO app_config (key, value)
--                         VALUES ('season_audit_secret', '<value>');
-- The functions base URL is read from the existing `notify_email_fn_url` row
-- (named for email, but it is the plain functions base — reused rather than
-- adding a second key that could drift out of step).
-- ============================================================================

CREATE OR REPLACE FUNCTION run_genius_season_audit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fn_url text;
  v_secret text;
BEGIN
  SELECT value INTO v_fn_url FROM app_config WHERE key = 'notify_email_fn_url';
  IF v_fn_url IS NULL OR v_fn_url = '' THEN RETURN; END IF;  -- not configured yet

  SELECT value INTO v_secret FROM app_config WHERE key = 'season_audit_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_fn_url || '/genius',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-audit-secret',  v_secret
    ),
    body    := jsonb_build_object('action', 'season_audit')
  );
EXCEPTION WHEN OTHERS THEN
  -- An audit is a convenience; never let it raise into whatever called it.
  RAISE WARNING '[season-audit] run_genius_season_audit failed: %', SQLERRM;
END;
$$;

-- Mondays 08:00 UTC, just before the weekly sweep. One /competitions call plus
-- one per league — ~300 upstream calls a year against a 20k/month quota.
SELECT cron.schedule(
  'genius-season-audit',
  '0 8 * * 1',
  'SELECT run_genius_season_audit()'
);
