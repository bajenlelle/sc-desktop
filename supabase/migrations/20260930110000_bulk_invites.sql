-- =============================================================================
-- Bulk email invites: per-address results, batched delivery, resend and revoke
--
-- The invite dialog now takes a pasted list (a whole roster at once). The old
-- send_org_invite_emails returned a bare count and skipped already-invited
-- addresses silently, did no normalizing or validation, had no size cap, and
-- queued one pg_net → send-email → Resend request per address, which a bulk
-- send would push past Resend's per-second rate limit.
--
-- - invite_by_email returns {sent, skipped[{email, reason}]}: trims and
--   lowercases, drops blanks and duplicates, and skips invalid addresses,
--   current members and live invites. Up to 200 per call and 500 emailed
--   invites per org per 24 hours. A per-org advisory lock keeps two
--   concurrent sends from inviting the same address twice.
-- - Delivery goes through _send_notification_emails_batch: one request per 100
--   addresses to send-email's batch mode (Resend /emails/batch). send-email
--   must be deployed with batch support before this migration.
-- - send_org_invite_emails stays, as a count-returning wrapper, for desktop
--   builds that predate invite_by_email.
-- - resend_org_invite / revoke_org_invite back the pending-invites list.
--   Admins manage every invite; coaches manage coach and player invites,
--   the same rule as sending. Resend keeps the invite's own role and team,
--   rotates the code and restarts the 7 days. Revoke replaces the admin-only
--   direct DELETE for this list (the link settings still use it).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Batched delivery. Internal helper: not callable by clients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _send_notification_emails_batch(
  p_template text,
  p_messages jsonb  -- [{ "to": text, "data": { … } }, …]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fn_url text;
  v_secret text;
  v_total  integer := COALESCE(jsonb_array_length(p_messages), 0);
  v_offset integer := 0;
  v_chunk  jsonb;
BEGIN
  IF v_total = 0 THEN RETURN; END IF;

  SELECT value INTO v_fn_url FROM app_config WHERE key = 'notify_email_fn_url';
  IF v_fn_url IS NULL THEN RETURN; END IF;  -- not configured yet, skip silently

  SELECT value INTO v_secret FROM app_config WHERE key = 'notify_email_secret';

  WHILE v_offset < v_total LOOP
    SELECT jsonb_agg(m ORDER BY i) INTO v_chunk
      FROM jsonb_array_elements(p_messages) WITH ORDINALITY AS t(m, i)
     WHERE i > v_offset AND i <= v_offset + 100;

    PERFORM net.http_post(
      url     := v_fn_url || '/send-email',
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'x-email-secret',  COALESCE(v_secret, '')
      ),
      body    := jsonb_build_object('template', p_template, 'batch', v_chunk),
      -- A batch of 100 renders and posts once; give it more than the 5s default.
      timeout_milliseconds := 15000
    );
    v_offset := v_offset + 100;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  -- Never let email failures break the main operation
  RAISE WARNING '[email] _send_notification_emails_batch failed for template %: %', p_template, SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION _send_notification_emails_batch(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. invite_by_email
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invite_by_email(
  p_org_id  uuid,
  p_emails  text[],
  p_role    text DEFAULT 'player',
  p_team_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_org         organizations%ROWTYPE;
  v_app_url     text;
  v_team_name   text;
  v_inviter     text;
  v_email       text;
  v_code        text;
  v_new         text[] := '{}';
  v_skipped     jsonb  := '[]'::jsonb;
  v_batch       jsonb  := '[]'::jsonb;
  v_recent      integer;
BEGIN
  SELECT role INTO v_caller_role
    FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role IN ('coach', 'player'))
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_role NOT IN ('coach', 'player', 'admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  IF NOT is_platform_admin() AND v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
    RAISE EXCEPTION 'license_expired';
  END IF;

  IF p_team_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'team_not_in_org';
  END IF;

  IF COALESCE(array_length(p_emails, 1), 0) > 200 THEN
    RAISE EXCEPTION 'too_many_emails';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('org_invites:' || p_org_id::text, 0));

  -- Normalize, drop blanks and duplicates, keep the paste order.
  FOR v_email IN
    SELECT e FROM (
      SELECT lower(trim(x)) AS e, min(ord) AS o
        FROM unnest(p_emails) WITH ORDINALITY AS u(x, ord)
       WHERE COALESCE(trim(x), '') <> ''
       GROUP BY 1
    ) s ORDER BY o
  LOOP
    IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'invalid');
    ELSIF EXISTS (
      SELECT 1 FROM org_memberships m JOIN auth.users u ON u.id = m.user_id
       WHERE m.org_id = p_org_id AND lower(u.email) = v_email
    ) THEN
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'already_member');
    ELSIF EXISTS (
      SELECT 1 FROM org_invites
       WHERE org_id = p_org_id AND lower(email) = v_email
         AND (expires_at IS NULL OR expires_at > now())
         AND (max_uses IS NULL OR used_count < max_uses)
    ) THEN
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'already_invited');
    ELSE
      v_new := array_append(v_new, v_email);
    END IF;
  END LOOP;

  -- Abuse cap: sending mail to arbitrary addresses from noreply@scoutable.se.
  SELECT count(*) INTO v_recent
    FROM org_invites
   WHERE org_id = p_org_id AND email IS NOT NULL AND created_at > now() - interval '24 hours';
  IF v_recent + COALESCE(array_length(v_new, 1), 0) > 500 THEN
    RAISE EXCEPTION 'daily_invite_limit';
  END IF;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');
  SELECT name INTO v_team_name FROM teams WHERE id = p_team_id;
  SELECT full_name INTO v_inviter FROM profiles WHERE id = v_uid;

  FOREACH v_email IN ARRAY v_new LOOP
    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
    END LOOP;

    INSERT INTO org_invites (org_id, code, role, email, created_by, max_uses, expires_at, is_national_team, team_id)
    VALUES (p_org_id, v_code, p_role, v_email, v_uid, 1, now() + interval '7 days',
            COALESCE(v_org.is_nt_org, false), p_team_id);

    v_batch := v_batch || jsonb_build_object(
      'to', v_email,
      'data', jsonb_strip_nulls(jsonb_build_object(
        'org_name',     v_org.name,
        'role',         p_role,
        'invite_url',   v_app_url || '/join/' || v_code,
        'team_name',    v_team_name,
        'inviter_name', v_inviter
      ))
    );
  END LOOP;

  PERFORM _send_notification_emails_batch('org_invite', v_batch);

  RETURN jsonb_build_object('sent', to_jsonb(v_new), 'skipped', v_skipped);
END;
$$;

REVOKE EXECUTE ON FUNCTION invite_by_email(uuid, text[], text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION invite_by_email(uuid, text[], text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The old entry point, kept for desktop builds that call it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_org_invite_emails(
  p_org_id  uuid,
  p_emails  text[],
  p_role    text DEFAULT 'coach',
  p_team_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_array_length(invite_by_email(p_org_id, p_emails, p_role, p_team_id) -> 'sent');
$$;

-- ---------------------------------------------------------------------------
-- 4. Resend and revoke, for the pending-invites list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _can_manage_invite(p_invite org_invites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM org_memberships
     WHERE user_id = auth.uid() AND org_id = p_invite.org_id
       AND (role = 'admin' OR (role = 'coach' AND p_invite.role IN ('coach', 'player')))
  );
$$;

REVOKE EXECUTE ON FUNCTION _can_manage_invite(org_invites) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION resend_org_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_invite  org_invites%ROWTYPE;
  v_org     organizations%ROWTYPE;
  v_code    text;
  v_app_url text;
BEGIN
  SELECT * INTO v_invite FROM org_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR v_invite.email IS NULL THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF NOT _can_manage_invite(v_invite) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'invite_used';
  END IF;

  -- Once an hour at most, so resend can't be used to flood one inbox.
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at > now() + interval '7 days' - interval '1 hour' THEN
    RAISE EXCEPTION 'resent_recently';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_invite.org_id;
  IF NOT is_platform_admin() AND v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
    RAISE EXCEPTION 'license_expired';
  END IF;

  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
  END LOOP;

  UPDATE org_invites
     SET code = v_code, expires_at = now() + interval '7 days'
   WHERE id = v_invite.id;

  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  PERFORM _send_notification_email(
    v_invite.email,
    'org_invite',
    jsonb_strip_nulls(jsonb_build_object(
      'org_name',     v_org.name,
      'role',         v_invite.role,
      'invite_url',   v_app_url || '/join/' || v_code,
      'team_name',    (SELECT name FROM teams WHERE id = v_invite.team_id AND org_id = v_invite.org_id),
      'inviter_name', (SELECT full_name FROM profiles WHERE id = v_uid)
    ))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION resend_org_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resend_org_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_org_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite org_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM org_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF NOT _can_manage_invite(v_invite) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  DELETE FROM org_invites WHERE id = v_invite.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION revoke_org_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revoke_org_invite(uuid) TO authenticated;
