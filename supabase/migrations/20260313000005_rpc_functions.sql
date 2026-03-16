-- =============================================================================
-- RPC: create_org_for_user
-- Creates an org and sets the caller as admin. Errors if user already has an org.
-- =============================================================================
CREATE OR REPLACE FUNCTION create_org_for_user(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  -- Guard: user must not already belong to an org
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND org_id IS NOT NULL) THEN
    RAISE EXCEPTION 'already_in_org';
  END IF;

  INSERT INTO organizations (name) VALUES (org_name) RETURNING id INTO v_org_id;
  UPDATE profiles SET org_id = v_org_id, role = 'admin' WHERE id = v_uid;
  RETURN v_org_id;
END;
$$;

-- =============================================================================
-- RPC: create_team_for_org
-- Creates a team in the caller's org and adds them as coach. Requires admin role.
-- =============================================================================
CREATE OR REPLACE FUNCTION create_team_for_org(team_name text, team_season text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org_id  uuid;
  v_team_id uuid;
BEGIN
  -- Guard: caller must be org admin
  SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid AND role = 'admin';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  INSERT INTO teams (org_id, name, season)
    VALUES (v_org_id, team_name, team_season)
    RETURNING id INTO v_team_id;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_team_id, v_uid, 'coach');

  RETURN v_team_id;
END;
$$;

-- =============================================================================
-- RPC: join_team_by_code
-- Validates an invite code and adds the caller to the team.
-- =============================================================================
CREATE OR REPLACE FUNCTION join_team_by_code(invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite team_invites%ROWTYPE;
  v_org_id uuid;
BEGIN
  SELECT * INTO v_invite FROM team_invites WHERE code = invite_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'code_expired';
  END IF;
  IF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  SELECT t.org_id INTO v_org_id FROM teams t WHERE t.id = v_invite.team_id;

  INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_invite.team_id, v_uid, v_invite.role)
    ON CONFLICT (team_id, user_id) DO NOTHING;

  UPDATE profiles
    SET
      org_id = COALESCE(org_id, v_org_id),
      role   = CASE WHEN role = 'admin' THEN role ELSE v_invite.role END
    WHERE id = v_uid;

  UPDATE team_invites SET used_count = used_count + 1 WHERE id = v_invite.id;

  RETURN v_invite.team_id;
END;
$$;

-- =============================================================================
-- RPC: generate_team_invite
-- Generates a unique 6-char uppercase invite code for a team.
-- Caller must be a member of the team.
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_team_invite(
  p_team_id       uuid,
  p_role          text    DEFAULT 'player',
  p_max_uses      integer DEFAULT NULL,
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
  -- Guard: caller must be a team member
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'not_team_member';
  END IF;

  -- Generate unique 6-char code
  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM team_invites WHERE code = v_code);
  END LOOP;

  INSERT INTO team_invites (team_id, code, role, created_by, expires_at, max_uses)
    VALUES (
      p_team_id,
      v_code,
      p_role,
      v_uid,
      CASE WHEN p_expires_in_hours IS NOT NULL THEN now() + (p_expires_in_hours || ' hours')::interval ELSE NULL END,
      p_max_uses
    );

  RETURN v_code;
END;
$$;
