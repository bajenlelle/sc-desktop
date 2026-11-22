-- =============================================================================
-- Welcome email: hold 3 minutes instead of 10, checked every minute.
--
-- The welcome now arrives 3 to 4 minutes after confirming instead of 10 to 15.
-- The hold exists so club players (invite links leave no trace on the account,
-- see 20261118100000_onboarding_emails) are skipped once they have joined their
-- club or signed in on the phone app. In prod (120 days to 2026-11-22), 44 of
-- 53 such accounts did it within 2 minutes of confirming (max 1.9) and none
-- between 2 and 20 minutes, so 3 minutes skips everyone 10 minutes did. The
-- OAuth lang write the hold also waits for lands within seconds.
--
-- Only the hold in send_queued_welcomes() and the cron schedule change; the
-- function is otherwise identical. The resend limit stays at 10 minutes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The 1-minute sender. SKIP LOCKED, so overlapping runs can't both take a
-- row. A row that fails while being checked or built is marked 'error' and
-- the run goes on, so one bad row can't stall the queue. Returns how many
-- welcomes it sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_queued_welcomes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_reason text;
  v_msg    jsonb;
  v_batch  jsonb := '[]'::jsonb;
  v_sent   integer := 0;
BEGIN
  IF NOT _onboarding_enabled() THEN RETURN 0; END IF;

  FOR r IN
    SELECT q.user_id, q.queued_at, u.email
      FROM onboarding_emails q
      JOIN auth.users u ON u.id = q.user_id
     WHERE q.kind = 'welcome'
       AND q.sent_at IS NULL
       AND q.skipped_reason IS NULL
       AND q.queued_at <= now() - interval '3 minutes'
     ORDER BY q.queued_at
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      v_reason := _welcome_skip_reason(r.user_id);
      IF v_reason IS NULL AND r.queued_at < now() - interval '24 hours' THEN v_reason := 'stale'; END IF;
      IF v_reason IS NULL AND r.email IS NULL THEN v_reason := 'no_email'; END IF;

      IF v_reason IS NOT NULL THEN
        UPDATE onboarding_emails SET skipped_reason = v_reason
         WHERE user_id = r.user_id AND kind = 'welcome';
        CONTINUE;
      END IF;

      -- Build first: nothing below can fail once the row is marked sent.
      v_msg := jsonb_build_object('to', r.email, 'data', _onboarding_email_data(r.user_id, 'welcome'));
      UPDATE onboarding_emails SET sent_at = now()
       WHERE user_id = r.user_id AND kind = 'welcome';
      v_batch := v_batch || jsonb_build_array(v_msg);
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[onboarding] welcome for % failed, marked error: %', r.user_id, SQLERRM;
      UPDATE onboarding_emails SET skipped_reason = 'error'
       WHERE user_id = r.user_id AND kind = 'welcome';
    END;
  END LOOP;

  PERFORM _send_notification_emails_batch('welcome', v_batch);
  RETURN v_sent;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[onboarding] send_queued_welcomes failed: %', SQLERRM;
  RETURN 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION send_queued_welcomes() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cron (UTC): every minute.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'send-queued-welcomes';
    PERFORM cron.schedule('send-queued-welcomes', '* * * * *',
      'SELECT send_queued_welcomes()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule send-queued-welcomes manually';
  END IF;
END;
$$;
