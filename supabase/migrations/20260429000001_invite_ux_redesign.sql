-- =============================================================================
-- 20260429000001: Invite UX redesign
--
-- Changes:
--   1. Add optional `email` column to org_invites (for per-address invites)
--   2. Relax role CHECK to allow 'admin'
--   3. New RPC: send_org_invite_emails(p_org_id, p_emails, p_role)
--   4. New RPC: update_org_invite_expiry(p_invite_id, p_expires_in_hours)
-- =============================================================================

-- 1. Add email column (nullable — only set for personal email invites)
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS email text;

-- 2. Relax role check to allow 'admin' (needed for link invites with admin role)
ALTER TABLE org_invites DROP CONSTRAINT IF EXISTS org_invites_role_check;
ALTER TABLE org_invites ADD CONSTRAINT org_invites_role_check
  CHECK (role IN ('coach', 'player', 'admin'));

-- 3. send_org_invite_emails: generate a unique single-use invite per email address
--    and fire a notification email for each.
CREATE OR REPLACE FUNCTION send_org_invite_emails(
  p_org_id uuid,
  p_emails text[],
  p_role   text DEFAULT 'coach'
)
RETURNS integer   -- number of invites sent (skips duplicates)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_caller_role text;
  v_org_name   text;
  v_app_url    text;
  v_email      text;
  v_code       text;
  v_sent       integer := 0;
BEGIN
  -- Auth: must be org admin (via org_memberships) or platform admin
  -- Coaches can only send coach invites
  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;

  IF NOT (
    is_platform_admin()
    OR v_caller_role = 'admin'
    OR (v_caller_role = 'coach' AND p_role = 'coach')
  ) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_role NOT IN ('coach', 'player', 'admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = p_org_id;
  SELECT value INTO v_app_url FROM app_config WHERE key = 'app_url';
  v_app_url := COALESCE(v_app_url, 'https://app.scoutable.se');

  FOREACH v_email IN ARRAY p_emails LOOP
    -- Skip if there is already a pending invite for this email+org
    IF EXISTS (
      SELECT 1 FROM org_invites
      WHERE org_id = p_org_id AND email = v_email
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR used_count < max_uses)
    ) THEN
      CONTINUE;
    END IF;

    -- Generate unique code
    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
    END LOOP;

    INSERT INTO org_invites (org_id, code, role, email, created_by, max_uses, expires_at)
    VALUES (p_org_id, v_code, p_role, v_email, v_uid, 1, now() + interval '7 days');

    -- Send email (fire-and-forget; failures are silently warned)
    PERFORM _send_notification_email(
      v_email,
      'org_invite',
      jsonb_build_object(
        'org_name',   v_org_name,
        'role',       p_role,
        'invite_url', v_app_url || '/join/' || v_code
      )
    );

    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$$;

GRANT EXECUTE ON FUNCTION send_org_invite_emails(uuid, text[], text) TO authenticated;

-- 4. update_org_invite_expiry: set or clear expiry on an existing invite
CREATE OR REPLACE FUNCTION update_org_invite_expiry(
  p_invite_id        uuid,
  p_expires_in_hours integer  -- NULL = never expires
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
  v_caller_role text;
BEGIN
  SELECT org_id INTO v_org_id FROM org_invites WHERE id = p_invite_id;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT role INTO v_caller_role
  FROM org_memberships WHERE user_id = v_uid AND org_id = v_org_id;

  IF NOT (is_platform_admin() OR v_caller_role = 'admin') THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  UPDATE org_invites SET
    expires_at = CASE
      WHEN p_expires_in_hours IS NOT NULL THEN now() + (p_expires_in_hours || ' hours')::interval
      ELSE NULL
    END
  WHERE id = p_invite_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_invite_expiry(uuid, integer) TO authenticated;
