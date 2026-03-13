-- =============================================================================
-- RPC: generate_org_invite
-- Generates a unique 6-char uppercase invite code for an org.
-- Caller must be admin of the org.
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_org_invite(
  p_org_id           uuid,
  p_role             text    DEFAULT 'player',
  p_max_uses         integer DEFAULT NULL,
  p_expires_in_hours integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
BEGIN
  -- Guard: caller must be admin of this org
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND org_id = p_org_id AND role = 'admin') THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Generate unique 6-char code
  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM org_invites WHERE code = v_code);
  END LOOP;

  INSERT INTO org_invites (org_id, code, role, created_by, expires_at, max_uses)
    VALUES (
      p_org_id,
      v_code,
      p_role,
      v_uid,
      CASE WHEN p_expires_in_hours IS NOT NULL THEN now() + (p_expires_in_hours || ' hours')::interval ELSE NULL END,
      p_max_uses
    );

  RETURN v_code;
END;
$$;

-- =============================================================================
-- RPC: join_org_by_code
-- Validates an org invite code and sets the caller's org_id.
-- =============================================================================
CREATE OR REPLACE FUNCTION join_org_by_code(invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite org_invites%ROWTYPE;
  v_cur_org_id uuid;
BEGIN
  SELECT * INTO v_invite FROM org_invites WHERE code = invite_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'code_expired';
  END IF;
  IF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
  IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_invite.org_id THEN
    RAISE EXCEPTION 'already_in_different_org';
  END IF;

  UPDATE profiles
    SET
      org_id = v_invite.org_id,
      role   = CASE WHEN role = 'admin' THEN role ELSE v_invite.role END
    WHERE id = v_uid;

  UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_invite.id;

  RETURN v_invite.org_id;
END;
$$;

-- =============================================================================
-- RPC: assign_member_to_team
-- Admin directly assigns an org member to a team.
-- =============================================================================
CREATE OR REPLACE FUNCTION assign_member_to_team(
  p_user_id uuid,
  p_team_id uuid,
  p_role    text DEFAULT 'player'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_admin_org uuid;
BEGIN
  -- Guard: caller must be admin
  SELECT org_id INTO v_admin_org FROM profiles WHERE id = v_uid AND role = 'admin';
  IF v_admin_org IS NULL THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Guard: team must belong to caller's org and user must be in same org
  IF NOT EXISTS (
    SELECT 1
    FROM teams t
    JOIN profiles p ON p.id = p_user_id AND p.org_id = t.org_id
    WHERE t.id = p_team_id AND t.org_id = v_admin_org
  ) THEN
    RAISE EXCEPTION 'user_or_team_not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, p_user_id, p_role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = p_role;
END;
$$;

-- =============================================================================
-- RPC: join_org_team
-- Org member self-joins any team within their org.
-- =============================================================================
CREATE OR REPLACE FUNCTION join_org_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_in_org';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'team_not_in_org';
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (p_team_id, v_uid, 'player')
    ON CONFLICT (team_id, user_id) DO NOTHING;
END;
$$;
