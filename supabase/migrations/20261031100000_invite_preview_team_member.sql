-- The invite preview names the team and knows its members.
--
-- 1. An org invite that carries a team (an emailed player invite, or a link
--    made for a team) previewed with team_name null, so the join page and the
--    link preview named only the club. It now names the team too.
-- 2. Someone who already belongs to the club (and to the invite's team, when
--    it names one) gets `already_member` instead of the invite's state. A
--    signup confirmed on one device joins there; the browser that started
--    it still holds the invite and opens it again, and a single-use emailed
--    invite would have said "no longer available" to a member.
-- 3. generate_team_invite let any team member, players included, mint a
--    coach invite for their team: it never had the REVOKE that pairs with
--    a GRANT, so PUBLIC could call it, and its only guard is membership.
--    Nothing calls it any more (team invites are made with
--    generate_org_invite(..., p_team_id) into org_invites), so it loses
--    EXECUTE for everyone but the service role. Rows already in team_invites
--    keep redeeming through join_by_code.

CREATE OR REPLACE FUNCTION get_invite_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_code        text := upper(trim(p_code));
  v_org_invite  org_invites%ROWTYPE;
  v_team_invite team_invites%ROWTYPE;
  v_org_name    text;
  v_team_name   text;
  v_org         organizations%ROWTYPE;
  v_seat_role   text;
  v_count       integer;
  v_limit       integer;
BEGIN
  -- Try org_invites
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code;
  IF FOUND THEN
    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;
    IF v_org_invite.team_id IS NOT NULL THEN
      SELECT name INTO v_team_name FROM teams WHERE id = v_org_invite.team_id;
    END IF;

    -- Already in: the invite's state no longer matters to this person.
    IF v_uid IS NOT NULL
       AND EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id)
       AND (v_org_invite.team_id IS NULL OR EXISTS (
         SELECT 1 FROM team_members WHERE user_id = v_uid AND team_id = v_org_invite.team_id)) THEN
      RETURN jsonb_build_object(
        'valid',          true,
        'already_member', true,
        'org_name',       v_org.name,
        'team_name',      v_team_name,
        'role',           v_org_invite.role
      );
    END IF;

    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_invite');
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_license');
    END IF;

    -- Seat check — skipped for existing members (re-joins are allowed by
    -- join_by_code, which excludes self from the count).
    IF v_uid IS NULL OR NOT EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id
    ) THEN
      v_seat_role := CASE WHEN v_org_invite.role IN ('coach', 'admin') THEN 'coach' ELSE 'player' END;
      v_limit := CASE WHEN v_seat_role = 'coach' THEN v_org.coach_seat_limit ELSE v_org.player_seat_limit END;
      IF v_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count FROM org_memberships
          WHERE org_id = v_org.id
            AND CASE WHEN v_seat_role = 'coach' THEN role IN ('coach', 'admin') ELSE role = 'player' END;
        IF v_count >= v_limit THEN
          PERFORM _notify_seat_limit_hit(v_org.id, v_seat_role);
          RETURN jsonb_build_object('valid', false, 'reason', 'seat_limit_reached');
        END IF;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'valid',     true,
      'org_name',  v_org.name,
      'team_name', v_team_name,
      'role',      v_org_invite.role,
      'email',     v_org_invite.email
    );
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code;
  IF FOUND THEN
    SELECT o.name, t.name INTO v_org_name, v_team_name
      FROM teams t JOIN organizations o ON o.id = t.org_id
      WHERE t.id = v_team_invite.team_id;
    SELECT * INTO v_org FROM organizations
      WHERE id = (SELECT org_id FROM teams WHERE id = v_team_invite.team_id);

    IF v_uid IS NOT NULL
       AND EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id)
       AND EXISTS (SELECT 1 FROM team_members WHERE user_id = v_uid AND team_id = v_team_invite.team_id) THEN
      RETURN jsonb_build_object(
        'valid',          true,
        'already_member', true,
        'org_name',       v_org_name,
        'team_name',      v_team_name,
        'role',           v_team_invite.role
      );
    END IF;

    IF v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_invite');
    END IF;
    IF v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_license');
    END IF;

    IF v_uid IS NULL OR NOT EXISTS (
      SELECT 1 FROM org_memberships WHERE user_id = v_uid AND org_id = v_org.id
    ) THEN
      v_seat_role := CASE WHEN v_team_invite.role IN ('coach', 'admin') THEN 'coach' ELSE 'player' END;
      v_limit := CASE WHEN v_seat_role = 'coach' THEN v_org.coach_seat_limit ELSE v_org.player_seat_limit END;
      IF v_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count FROM org_memberships
          WHERE org_id = v_org.id
            AND CASE WHEN v_seat_role = 'coach' THEN role IN ('coach', 'admin') ELSE role = 'player' END;
        IF v_count >= v_limit THEN
          PERFORM _notify_seat_limit_hit(v_org.id, v_seat_role);
          RETURN jsonb_build_object('valid', false, 'reason', 'seat_limit_reached');
        END IF;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'valid',     true,
      'org_name',  v_org_name,
      'team_name', v_team_name,
      'role',      v_team_invite.role
    );
  END IF;

  RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
END;
$$;

REVOKE ALL ON FUNCTION get_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO anon;
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO authenticated;

REVOKE ALL ON FUNCTION generate_team_invite(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
