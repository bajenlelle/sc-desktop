-- ============================================================================
-- Make the personal org a guarantee rather than a convention
--
-- Every account gets a personal org + membership inside the signup
-- transaction (handle_new_user, 20260814000000), and 20260908110000
-- backfilled the users the 2026-05 sweep missed. Nothing enforced it
-- afterwards: remove_member_from_org would happily delete the membership row
-- that gives a user their personal space, and nothing would ever recreate it.
--
-- A user in that state has no space at all. On desktop that used to surface
-- as the full-screen "enter your invite code" wall, because the client read
-- "zero orgs" as "never onboarded" — with no way out but signing out.
--
-- 1. remove_member_from_org refuses to touch a personal org.
-- 2. ensure_personal_org() repairs an account that lost one; the clients call
--    it when a successful read comes back empty.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Never remove someone from their personal space.
--    Body copied from 20260902100000 with the guard added up front.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member_from_org(p_user_id uuid, p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_primary_org uuid;
  v_user_email  text;
  v_org_name    text;
BEGIN
  -- Personal spaces have exactly one member, who is 'admin' of it. Removing
  -- them leaves an account with nowhere to be, and no path back.
  IF EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id AND is_personal) THEN
    RAISE EXCEPTION 'cannot_remove_personal';
  END IF;

  IF NOT is_platform_admin() THEN
    SELECT role INTO v_caller_role
    FROM org_memberships WHERE user_id = v_uid AND org_id = p_org_id;
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id) THEN
      RAISE EXCEPTION 'user_not_in_org';
    END IF;
  END IF;

  -- Capture email and org name before removing
  v_user_email := _get_user_email(p_user_id);
  SELECT name INTO v_org_name FROM organizations WHERE id = p_org_id;

  -- Always remove from team_members in this org (primary or secondary)
  DELETE FROM team_members
    WHERE user_id = p_user_id
      AND team_id IN (SELECT id FROM teams WHERE org_id = p_org_id);

  -- Only detach profiles.org_id when this is the user's primary org
  SELECT org_id INTO v_primary_org FROM profiles WHERE id = p_user_id;
  IF v_primary_org = p_org_id THEN
    UPDATE profiles SET org_id = NULL, role = 'coach' WHERE id = p_user_id;
  END IF;

  DELETE FROM org_memberships WHERE user_id = p_user_id AND org_id = p_org_id;

  -- Email restored (regressed in 20260505000003): notify the removed member.
  IF v_user_email IS NOT NULL AND v_org_name IS NOT NULL THEN
    PERFORM _send_notification_email(
      v_user_email,
      'removed_from_org',
      jsonb_build_object('org_name', v_org_name)
    );
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Idempotent repair. Same shape as handle_new_user's personal-org branch.
--    Returns the existing org when there is one, so callers can fire it
--    speculatively without checking first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_personal_org()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid;
  v_org_id uuid;
  v_name   text;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Serialize per user: two clients racing this on boot would otherwise mint
  -- two personal orgs, and nothing downstream expects more than one.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_personal_org:' || v_uid::text));

  SELECT om.org_id INTO v_org_id
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = v_uid AND o.is_personal
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(full_name), ''), 'Personal') INTO v_name
  FROM profiles WHERE id = v_uid;

  INSERT INTO organizations (name, is_personal)
  VALUES (COALESCE(v_name, 'Personal'), true)
  RETURNING id INTO v_org_id;

  INSERT INTO org_memberships (org_id, user_id, role)
  VALUES (v_org_id, v_uid, 'admin');

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_personal_org() TO authenticated;
