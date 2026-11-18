-- =============================================================================
-- Onboarding emails: a welcome after confirming, one reminder, a resend.
--
-- Spec: founder/plans/2026-11-18-phone-signup-welcome-design.md, "Who gets the
-- welcome email". Everyone newly confirmed gets the welcome except club
-- members.
--
-- Why a hold: an account rarely records that it came from an invite. Only a
-- web email signup from a /join/CODE link writes pending_invite into the
-- metadata; phone-app signups, Google/Apple on web (code only in a cookie) and
-- phone join links (code in memory) leave no trace at confirm time, and those
-- are the common paths for players. So the trigger on auth.users only QUEUES
-- the welcome. A cron every 5 minutes sends queued welcomes at least 10
-- minutes old, and marks skipped (never sends) any account that by then
--   - has pending_invite in its metadata           ('invite'),
--   - is a member of a non-personal org            ('club'),
--   - has signed in on the phone app (club-only)   ('mobile').
-- A welcome still queued after 24 hours is marked 'stale', never sent. The
-- hold also gives the web app time to write lang for Google/Apple signups;
-- the email's data is read when it is sent, not when it is queued.
--
-- Reminder: once per account, 2 to 7 days after the welcome was sent, never
-- when the welcome was skipped (a later resend doesn't change that) or the
-- account now meets a skip rule, only without a desktop sign-in and only to accounts that can take marketing email
-- (_marketing_unsubscribe_url, the same rule as the free refills). It carries
-- an unsubscribe link.
--
-- Resend: the signed-in person's own welcome, once per 10 minutes, no skip
-- rules (they asked for it).
--
-- Switch: app_config onboarding_emails_enabled = 'true' turns sending on;
-- absent or anything else is off. Both senders and the resend check it; the
-- trigger always queues. To go live:
--   INSERT INTO app_config (key, value) VALUES ('onboarding_emails_enabled', 'true')
--     ON CONFLICT (key) DO UPDATE SET value = 'true';
-- The send-email function must know the 'welcome' and 'onboarding_reminder'
-- templates first.
--
-- Sends are at-most-once: a row is marked sent when its request is queued,
-- so if notify_email_fn_url is missing or pg_net fails the email is lost.
-- Confirm notify_email_fn_url before turning the switch on.
--
-- Crons (UTC): send-queued-welcomes */5 * * * *, onboarding-reminders 0 8 * * *.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The queue. One row per account and kind. Service role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_emails (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('welcome', 'reminder')),
  queued_at       timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  skipped_reason  text,           -- invite | club | mobile | stale | no_email | error
  last_resent_at  timestamptz,    -- welcome only: the resend limit
  PRIMARY KEY (user_id, kind)
);
ALTER TABLE onboarding_emails ENABLE ROW LEVEL SECURITY;  -- no policies

-- What the 5-minute cron scans.
CREATE INDEX IF NOT EXISTS idx_onboarding_emails_pending
  ON onboarding_emails (queued_at)
  WHERE sent_at IS NULL AND skipped_reason IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Helpers. Internal: not callable by clients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _onboarding_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM app_config WHERE key = 'onboarding_emails_enabled') = 'true', false);
$$;

-- NULL = send. Checked at send time, in this order.
CREATE OR REPLACE FUNCTION _welcome_skip_reason(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM auth.users u
                  WHERE u.id = p_user AND COALESCE(u.raw_user_meta_data, '{}'::jsonb) ? 'pending_invite')
      THEN 'invite'
    WHEN EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                  WHERE m.user_id = p_user AND NOT o.is_personal)
      THEN 'club'
    WHEN EXISTS (SELECT 1 FROM user_devices d WHERE d.user_id = p_user AND d.app = 'mobile')
      THEN 'mobile'
  END;
$$;

-- The template data: {lang, role, first_name, mac_url, win_url}, plus
-- unsubscribe_url for the reminder. Missing values are left out. role comes
-- from profiles.declared_role (set at sign-up or inferred from a membership),
-- falling back to the sign-up metadata.
CREATE OR REPLACE FUNCTION _onboarding_email_data(p_user uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta    jsonb;
  v_lang    text;
  v_role    text;
  v_site    text;
  v_query   text;
  v_unsub   text;
BEGIN
  SELECT COALESCE(raw_user_meta_data, '{}'::jsonb) INTO v_meta FROM auth.users WHERE id = p_user;
  v_meta := COALESCE(v_meta, '{}'::jsonb);

  v_lang := CASE WHEN v_meta->>'lang' IN ('sv', 'en') THEN v_meta->>'lang' ELSE 'en' END;
  v_role := COALESCE(
    (SELECT declared_role FROM profiles WHERE id = p_user AND declared_role IN ('coach', 'player')),
    CASE WHEN v_meta->>'declared_role' IN ('coach', 'player') THEN v_meta->>'declared_role' END);
  v_site := rtrim(COALESCE((SELECT value FROM app_config WHERE key = 'site_url'), 'https://scoutable.se'), '/');
  v_query := '?utm_source=' || CASE WHEN p_kind = 'reminder' THEN 'reminder_email' ELSE 'welcome_email' END
          || '&utm_medium=email&utm_campaign=onboarding&lang=' || v_lang;

  IF p_kind = 'reminder' THEN
    v_unsub := _marketing_unsubscribe_url(
      p_user, COALESCE((SELECT email_requires_consent FROM free_refill_settings LIMIT 1), false));
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'lang',            v_lang,
    'role',            v_role,
    'first_name',      NULLIF(split_part(btrim(COALESCE(v_meta->>'full_name', '')), ' ', 1), ''),
    'mac_url',         v_site || '/download/mac' || v_query,
    'win_url',         v_site || '/download/windows' || v_query,
    'unsubscribe_url', v_unsub
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION _onboarding_enabled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _welcome_skip_reason(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _onboarding_email_data(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Queue the welcome when an account is confirmed: at sign-up (Google,
--    Apple) or when the email link is clicked. Separate from handle_new_user,
--    and never blocks sign-up or sign-in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _queue_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO onboarding_emails (user_id, kind) VALUES (NEW.id, 'welcome')
      ON CONFLICT DO NOTHING;
    ELSIF OLD.email_confirmed_at IS NULL THEN
      INSERT INTO onboarding_emails (user_id, kind) VALUES (NEW.id, 'welcome')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[onboarding] queueing the welcome failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION _queue_welcome_email() FROM PUBLIC, anon, authenticated;

-- Two triggers with WHEN clauses, so the function never runs on ordinary
-- sign-in updates; the function keeps its own guard as well.
DROP TRIGGER IF EXISTS on_auth_user_created_queue_welcome ON auth.users;
CREATE TRIGGER on_auth_user_created_queue_welcome
  AFTER INSERT ON auth.users
  FOR EACH ROW WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION _queue_welcome_email();

DROP TRIGGER IF EXISTS on_auth_user_confirmed_queue_welcome ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_queue_welcome
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION _queue_welcome_email();

-- ---------------------------------------------------------------------------
-- 4. The 5-minute sender. SKIP LOCKED, so overlapping runs can't both take a
--    row. A row that fails while being checked or built is marked 'error'
--    and the run goes on, so one bad row can't stall the queue. Returns how
--    many welcomes it sent.
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
       AND q.queued_at <= now() - interval '10 minutes'
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
-- 5. The daily reminder. Set-based: one statement picks, records and builds.
--    Returns how many it sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_onboarding_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consent boolean;
  v_batch   jsonb;
  v_sent    integer;
BEGIN
  IF NOT _onboarding_enabled() THEN RETURN 0; END IF;

  v_consent := COALESCE((SELECT email_requires_consent FROM free_refill_settings LIMIT 1), false);

  WITH picked AS (
    SELECT w.user_id, u.email
      FROM onboarding_emails w
      JOIN auth.users u ON u.id = w.user_id
     WHERE w.kind = 'welcome'
       AND w.skipped_reason IS NULL
       AND w.sent_at <= now() - interval '48 hours'
       AND w.sent_at >= now() - interval '7 days'
       AND u.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM onboarding_emails r
                        WHERE r.user_id = w.user_id AND r.kind = 'reminder')
       AND NOT EXISTS (SELECT 1 FROM user_devices d
                        WHERE d.user_id = w.user_id AND d.app = 'desktop')
       AND _marketing_unsubscribe_url(w.user_id, v_consent) IS NOT NULL
       AND _welcome_skip_reason(w.user_id) IS NULL
       FOR UPDATE OF w SKIP LOCKED
  ), ins AS (
    INSERT INTO onboarding_emails (user_id, kind, sent_at)
    SELECT user_id, 'reminder', now() FROM picked
    ON CONFLICT DO NOTHING
    RETURNING user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'to', p.email, 'data', _onboarding_email_data(p.user_id, 'reminder'))), '[]'::jsonb),
         count(*)
    INTO v_batch, v_sent
    FROM ins JOIN picked p USING (user_id);

  PERFORM _send_notification_emails_batch('onboarding_reminder', v_batch);
  RETURN v_sent;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[onboarding] send_onboarding_reminders failed: %', SQLERRM;
  RETURN 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION send_onboarding_reminders() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Resend (the web button). The caller's own welcome, once per 10 minutes.
--    Marks the welcome sent if it wasn't, so a queued one isn't sent again,
--    and never moves an earlier sent_at (the reminder counts from it).
--    Returns 'sent' | 'too_soon' | 'disabled'; only not_authenticated and
--    no_email raise. 'sent' means queued, not delivered:
--    _send_notification_emails_batch posts asynchronously (pg_net) and turns
--    its own errors into a WARNING, so a failed send still returns 'sent'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resend_welcome_email()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_last  timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT _onboarding_enabled() THEN RETURN 'disabled'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'no_email'; END IF;

  SELECT last_resent_at INTO v_last FROM onboarding_emails
   WHERE user_id = v_uid AND kind = 'welcome'
     FOR UPDATE;
  IF v_last > now() - interval '10 minutes' THEN RETURN 'too_soon'; END IF;

  INSERT INTO onboarding_emails (user_id, kind, sent_at, last_resent_at)
  VALUES (v_uid, 'welcome', now(), now())
  ON CONFLICT (user_id, kind) DO UPDATE
    SET sent_at        = COALESCE(onboarding_emails.sent_at, now()),
        last_resent_at = now();

  PERFORM _send_notification_emails_batch('welcome', jsonb_build_array(jsonb_build_object(
    'to', v_email, 'data', _onboarding_email_data(v_uid, 'welcome'))));
  RETURN 'sent';
END;
$$;

REVOKE EXECUTE ON FUNCTION resend_welcome_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resend_welcome_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Crons (UTC).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'send-queued-welcomes';
    PERFORM cron.schedule('send-queued-welcomes', '*/5 * * * *',
      'SELECT send_queued_welcomes()');
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'onboarding-reminders';
    PERFORM cron.schedule('onboarding-reminders', '0 8 * * *',
      'SELECT send_onboarding_reminders()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule send-queued-welcomes and onboarding-reminders manually';
  END IF;
END;
$$;
