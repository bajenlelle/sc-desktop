-- Counts for the "Delete team?" confirmation.
--
-- Deleting a team is irreversible and its blast radius is not obvious from the
-- UI: playlist_shares.team_id is ON DELETE CASCADE, so every playlist shared
-- with the team stops being shared and those players lose access to the film.
-- team_members and team_invites cascade too; org_invites.team_id is SET NULL.
--
-- The client cannot count this itself. playlist_shares RLS only exposes rows
-- for teams the caller personally belongs to (playlist_shares_team_read) or
-- playlists they own (playlist_shares_owner), so an admin deleting a team they
-- are not a member of would be shown 0 — an undercount on a destructive
-- action, which is worse than no number at all. Hence a definer function,
-- gated exactly like delete_team.

CREATE OR REPLACE FUNCTION team_delete_impact(p_team_id uuid)
RETURNS TABLE (
  member_count integer,
  shared_playlist_count integer,
  invite_link_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM teams WHERE id = p_team_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found';
  END IF;

  IF NOT is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE user_id = v_uid AND org_id = v_org_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*)::integer FROM team_members WHERE team_id = p_team_id),
    -- DISTINCT: a playlist can in principle hold more than one share row for
    -- the same team, and the number the admin cares about is playlists.
    (SELECT count(DISTINCT playlist_id)::integer FROM playlist_shares WHERE team_id = p_team_id),
    (SELECT count(*)::integer FROM team_invites WHERE team_id = p_team_id);
END;
$$;

GRANT EXECUTE ON FUNCTION team_delete_impact(uuid) TO authenticated;
