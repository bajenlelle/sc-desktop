-- =============================================================================
-- Marketing email preferences and unsubscribe
--
-- Until now every email was transactional. The free-import refill email
-- (20261001120000) carries an upgrade offer, so it is marketing: every one
-- has an unsubscribe link, and nobody who unsubscribed gets another.
--
-- For now (Leonard, 2026-10-01) it goes to every account that hasn't
-- unsubscribed, opted in or not; free_refill_settings.email_requires_consent
-- switches it to opt-in only. Explicit consent is still recorded
-- (marketing_consent_at), so that switch needs no backfill.
--
-- Kept out of profiles on purpose: profiles rows are readable by org peers
-- (profiles_select_own_or_same_org), and the unsubscribe token must not be.
-- Clients read their own row and change consent only through
-- set_marketing_consent, so the timestamp is the server's.
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_preferences (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  marketing_consent_at  timestamptz,           -- null = no marketing email
  unsubscribed_at       timestamptz,
  unsubscribe_token     uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_preferences_select_own ON email_preferences FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 1. Every new account gets a row. A marketing_consent flag in the auth
--    metadata (no form sends one right now) records an explicit opt-in. A
--    separate trigger, so handle_new_user and the account never depend on it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user_email_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.email_preferences (user_id, marketing_consent_at)
  VALUES (
    NEW.id,
    CASE WHEN NEW.raw_user_meta_data->>'marketing_consent' = 'true' THEN now() END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block an account over an email preference.
  RAISE WARNING '[email_preferences] insert failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_email_preferences ON auth.users;
CREATE TRIGGER on_auth_user_created_email_preferences
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_email_preferences();

-- Existing users: a row each (not unsubscribed, no explicit opt-in).
INSERT INTO email_preferences (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The profile toggle (web, desktop).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_marketing_consent(p_consent boolean)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_at  timestamptz := CASE WHEN p_consent THEN now() END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO email_preferences (user_id, marketing_consent_at, unsubscribed_at, updated_at)
  VALUES (v_uid, v_at, CASE WHEN NOT p_consent THEN now() END, now())
  ON CONFLICT (user_id) DO UPDATE SET
    -- Re-ticking keeps the original consent time.
    marketing_consent_at = CASE WHEN p_consent
                                THEN COALESCE(email_preferences.marketing_consent_at, now())
                           END,
    unsubscribed_at = CASE WHEN p_consent THEN NULL ELSE now() END,
    updated_at = now();

  RETURN (SELECT marketing_consent_at FROM email_preferences WHERE user_id = v_uid);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_marketing_consent(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_marketing_consent(boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Unsubscribe link (web /unsubscribe page and the RFC 8058 one-click POST).
--    Anyone holding the token can withdraw consent, which is the point;
--    it can never grant consent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION unsubscribe_marketing(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE email_preferences
     SET marketing_consent_at = NULL,
         unsubscribed_at = COALESCE(unsubscribed_at, now()),
         updated_at = now()
   WHERE unsubscribe_token = p_token;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION unsubscribe_marketing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unsubscribe_marketing(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. For marketing templates: the user's unsubscribe link, or NULL when they
--    mustn't be emailed (callers then don't send). Never after an
--    unsubscribe; with p_require_consent, only after an explicit opt-in.
--    Internal helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _marketing_unsubscribe_url(p_user uuid, p_require_consent boolean DEFAULT false)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM app_config WHERE key = 'app_url'), 'https://app.scoutable.se')
         || '/unsubscribe?t=' || ep.unsubscribe_token::text
    FROM email_preferences ep
   WHERE ep.user_id = p_user
     AND ep.unsubscribed_at IS NULL
     AND (NOT p_require_consent OR ep.marketing_consent_at IS NOT NULL);
$$;

REVOKE EXECUTE ON FUNCTION _marketing_unsubscribe_url(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION handle_new_user_email_preferences() FROM PUBLIC, anon, authenticated;
