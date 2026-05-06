-- Multi-org workspace model: all orgs are equal (no primary/secondary distinction).
--
-- Changes:
-- 1. get_my_orgs() — returns ALL orgs the user belongs to (no IS DISTINCT FROM filter)
-- 2. get_my_secondary_orgs() — kept as backward-compat alias, returns same as get_my_orgs()
-- 3. join_by_code() — simplified: all org joins are additive; removed already_in_different_org
--    guard and profiles.org_id writes. is_nt_org stays on organizations for league import only.

-- ---------------------------------------------------------------------------
-- 1. get_my_orgs(): unified org list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_orgs()
RETURNS TABLE (org_id uuid, org_name text, role text, is_nt_org boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT om.org_id, o.name, om.role, COALESCE(o.is_nt_org, false)
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = (SELECT auth.uid());
$$;

GRANT EXECUTE ON FUNCTION get_my_orgs() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_my_secondary_orgs(): backward-compat alias
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_secondary_orgs()
RETURNS TABLE (org_id uuid, org_name text, role text, is_nt_org boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM get_my_orgs();
$$;

-- ---------------------------------------------------------------------------
-- 3. join_by_code(): simplified — all org joins are additive
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_code         text := upper(trim(p_code));
  v_org_invite   org_invites%ROWTYPE;
  v_team_invite  team_invites%ROWTYPE;
  v_org          organizations%ROWTYPE;
  v_org_id       uuid;
  v_coach_count  integer;
  v_player_count integer;
BEGIN
  -- Try org_invites first
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    -- Seat limit check (counts existing members, excluding self for re-join)
    IF v_org_invite.role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count
          FROM org_memberships
          WHERE org_id = v_org.id
            AND role IN ('coach', 'admin')
            AND user_id != v_uid;
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_org_invite.role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count
          FROM org_memberships
          WHERE org_id = v_org.id
            AND role = 'player'
            AND user_id != v_uid;
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
    END IF;

    -- Additive join — no primary/secondary distinction, no profiles.org_id write
    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org.id, v_org_invite.role)
      ON CONFLICT (user_id, org_id) DO UPDATE SET role =
        CASE WHEN v_org_invite.role = 'admin' THEN 'admin'
             WHEN org_memberships.role = 'admin' THEN 'admin'
             ELSE v_org_invite.role END;

    IF v_org_invite.team_id IS NOT NULL THEN
      INSERT INTO team_members (team_id, user_id, role)
        VALUES (v_org_invite.team_id, v_uid, v_org_invite.role)
        ON CONFLICT (team_id, user_id) DO NOTHING;
    END IF;

    UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
    RETURN jsonb_build_object('type', 'org', 'org_id', v_org.id);
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code FOR UPDATE;
  IF FOUND THEN
    IF v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now() THEN
      RAISE EXCEPTION 'code_expired';
    END IF;
    IF v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses THEN
      RAISE EXCEPTION 'code_exhausted';
    END IF;

    SELECT t.org_id INTO v_org_id FROM teams t WHERE t.id = v_team_invite.team_id;
    SELECT * INTO v_org FROM organizations WHERE id = v_org_id;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    -- Seat limit check
    IF v_team_invite.role IN ('coach', 'admin') THEN
      IF v_org.coach_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_coach_count
          FROM org_memberships
          WHERE org_id = v_org_id
            AND role IN ('coach', 'admin')
            AND user_id != v_uid;
        IF v_coach_count >= v_org.coach_seat_limit THEN
          RAISE EXCEPTION 'coach_seat_limit_reached';
        END IF;
      END IF;
    ELSIF v_team_invite.role = 'player' THEN
      IF v_org.player_seat_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_player_count
          FROM org_memberships
          WHERE org_id = v_org_id
            AND role = 'player'
            AND user_id != v_uid;
        IF v_player_count >= v_org.player_seat_limit THEN
          RAISE EXCEPTION 'player_seat_limit_reached';
        END IF;
      END IF;
    END IF;

    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org_id, v_team_invite.role)
      ON CONFLICT (user_id, org_id) DO NOTHING;

    INSERT INTO team_members (team_id, user_id, role)
      VALUES (v_team_invite.team_id, v_uid, v_team_invite.role)
      ON CONFLICT (team_id, user_id) DO NOTHING;

    UPDATE team_invites SET used_count = used_count + 1 WHERE id = v_team_invite.id;
    RETURN jsonb_build_object('type', 'team', 'org_id', v_org_id, 'team_id', v_team_invite.team_id);
  END IF;

  RAISE EXCEPTION 'invalid_code';
END;
$$;

GRANT EXECUTE ON FUNCTION join_by_code(text) TO authenticated;
