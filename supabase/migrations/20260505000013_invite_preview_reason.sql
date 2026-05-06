-- Update get_invite_preview to return a discriminated `reason` field whenever
-- valid is false. Reasons: 'not_found' | 'expired_invite' | 'exhausted' |
-- 'expired_license'. Existing callers can ignore the new field.

CREATE OR REPLACE FUNCTION get_invite_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code        text := upper(trim(p_code));
  v_org_invite  org_invites%ROWTYPE;
  v_team_invite team_invites%ROWTYPE;
  v_org_name    text;
  v_team_name   text;
  v_org         organizations%ROWTYPE;
BEGIN
  -- Try org_invites
  SELECT * INTO v_org_invite FROM org_invites WHERE code = v_code;
  IF FOUND THEN
    IF v_org_invite.expires_at IS NOT NULL AND v_org_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_invite');
    END IF;
    IF v_org_invite.max_uses IS NOT NULL AND v_org_invite.used_count >= v_org_invite.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;

    SELECT * INTO v_org FROM organizations WHERE id = v_org_invite.org_id;
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_license');
    END IF;

    RETURN jsonb_build_object(
      'valid',     true,
      'org_name',  v_org.name,
      'team_name', null::text,
      'role',      v_org_invite.role,
      'email',     v_org_invite.email
    );
  END IF;

  -- Try team_invites
  SELECT * INTO v_team_invite FROM team_invites WHERE code = v_code;
  IF FOUND THEN
    IF v_team_invite.expires_at IS NOT NULL AND v_team_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_invite');
    END IF;
    IF v_team_invite.max_uses IS NOT NULL AND v_team_invite.used_count >= v_team_invite.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;

    SELECT o.name, t.name INTO v_org_name, v_team_name
      FROM teams t JOIN organizations o ON o.id = t.org_id
      WHERE t.id = v_team_invite.team_id;

    SELECT * INTO v_org FROM organizations
      WHERE id = (SELECT org_id FROM teams WHERE id = v_team_invite.team_id);
    IF v_org.expires_at IS NOT NULL AND v_org.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired_license');
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

GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO anon;
