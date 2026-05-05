-- Restore seat limit enforcement in join_by_code.
--
-- Seat limit checks were dropped when join_by_code was rewritten in
-- 20260427000001_org_memberships.sql. They are now added back for both the
-- NT/secondary org path and the club org path.
--
-- Counts use org_memberships (authoritative for all org types).
-- The joining user is excluded from the count (user_id != v_uid) so that
-- re-joining (ON CONFLICT) an org at the same role doesn't count twice.

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
  v_cur_org_id   uuid;
  v_is_nt_org    boolean;
  v_new_role     text;
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
    v_is_nt_org := COALESCE(v_org.is_nt_org, false);

    -- Check license expiry (both paths)
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    IF v_is_nt_org THEN
      -- NT / SECONDARY ORG PATH: additive, don't touch profiles.org_id

      -- Seat limit check (count existing members, excluding self for re-join)
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

      INSERT INTO org_memberships (user_id, org_id, role)
        VALUES (v_uid, v_org.id, v_org_invite.role)
        ON CONFLICT (user_id, org_id) DO UPDATE SET role =
          CASE WHEN v_org_invite.role = 'admin' THEN 'admin'
               WHEN org_memberships.role = 'admin' THEN 'admin'
               ELSE v_org_invite.role END;

      -- Assign to team if specified
      IF v_org_invite.team_id IS NOT NULL THEN
        INSERT INTO team_members (team_id, user_id, role)
          VALUES (v_org_invite.team_id, v_uid, v_org_invite.role)
          ON CONFLICT (team_id, user_id) DO NOTHING;
      END IF;

      UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
      RETURN jsonb_build_object('type', 'secondary_org', 'org_id', v_org.id);

    ELSE
      -- CLUB ORG PATH: check not already in a different org
      SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
      IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_org.id THEN
        RAISE EXCEPTION 'already_in_different_org';
      END IF;

      -- Determine new role (keep highest privilege)
      SELECT CASE
        WHEN v_org_invite.role = 'admin' THEN 'admin'
        WHEN COALESCE(p.role, 'coach') = 'admin' THEN 'admin'
        ELSE v_org_invite.role
      END INTO v_new_role
      FROM profiles p WHERE p.id = v_uid;

      -- Seat limit check using resolved role
      IF v_new_role IN ('coach', 'admin') THEN
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
      ELSIF v_new_role = 'player' THEN
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

      -- Update primary org in profiles
      UPDATE profiles
        SET org_id = v_org.id,
            role   = v_new_role
        WHERE id = v_uid;

      -- Upsert into org_memberships
      INSERT INTO org_memberships (user_id, org_id, role)
        VALUES (v_uid, v_org.id, v_new_role)
        ON CONFLICT (user_id, org_id) DO UPDATE SET role =
          CASE WHEN v_new_role = 'admin' THEN 'admin'
               WHEN org_memberships.role = 'admin' THEN 'admin'
               ELSE v_new_role END;

      -- Assign to team if specified
      IF v_org_invite.team_id IS NOT NULL THEN
        INSERT INTO team_members (team_id, user_id, role)
          VALUES (v_org_invite.team_id, v_uid, v_org_invite.role)
          ON CONFLICT (team_id, user_id) DO NOTHING;
      END IF;

      UPDATE org_invites SET used_count = used_count + 1 WHERE id = v_org_invite.id;
      RETURN jsonb_build_object('type', 'org', 'org_id', v_org.id);
    END IF;
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

    SELECT org_id INTO v_cur_org_id FROM profiles WHERE id = v_uid;
    IF v_cur_org_id IS NOT NULL AND v_cur_org_id != v_org_id THEN
      RAISE EXCEPTION 'already_in_different_org';
    END IF;

    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RAISE EXCEPTION 'license_expired';
    END IF;

    SELECT CASE WHEN COALESCE(p.role, 'coach') = 'admin' THEN 'admin' ELSE v_team_invite.role END
    INTO v_new_role FROM profiles p WHERE p.id = v_uid;

    -- Seat limit check
    IF v_new_role IN ('coach', 'admin') THEN
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
    ELSIF v_new_role = 'player' THEN
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

    UPDATE profiles
      SET org_id = COALESCE(org_id, v_org_id),
          role   = v_new_role
      WHERE id = v_uid;

    INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (v_uid, v_org_id, v_new_role)
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
