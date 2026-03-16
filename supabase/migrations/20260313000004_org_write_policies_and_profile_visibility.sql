-- Any authenticated user can create an org (one-org-per-user enforced in RPC)
CREATE POLICY organizations_insert_authenticated ON organizations
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- Org admin can update their org
CREATE POLICY organizations_update_own ON organizations
  FOR UPDATE
  USING (id IN (SELECT org_id FROM profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (id IN (SELECT org_id FROM profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));

-- Org admin can insert teams in their org
CREATE POLICY teams_insert_org_admin ON teams
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
  );

-- Profiles: drop own-only policy, replace with own + same-org policy
DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own_or_same_org ON profiles
  FOR SELECT USING (
    id = (SELECT auth.uid())
    OR (
      org_id IS NOT NULL
      AND org_id IN (
        SELECT org_id FROM profiles
        WHERE id = (SELECT auth.uid()) AND org_id IS NOT NULL
      )
    )
  );

-- Team playlists: members of the assigned team can read the playlist
CREATE POLICY playlists_team_read ON playlists
  FOR SELECT USING (
    team_id IS NOT NULL
    AND team_id IN (SELECT team_id FROM team_members WHERE user_id = (SELECT auth.uid()))
  );

-- Team playlist clips: members can read clips of team playlists
CREATE POLICY playlist_clips_team_read ON playlist_clips
  FOR SELECT USING (
    playlist_id IN (
      SELECT id FROM playlists
      WHERE team_id IS NOT NULL
        AND team_id IN (SELECT team_id FROM team_members WHERE user_id = (SELECT auth.uid()))
    )
  );
