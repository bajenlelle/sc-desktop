-- Tighten playlist visibility: players should only see playlists for teams they belong to.
--
-- Problem: playlists_org_read was granting all org members access to all playlists
-- in the org regardless of team membership, causing "Unassigned" grouping for players
-- not in team_members, and no video access since current_user_team_ids() returned empty.
--
-- Fix:
--   1. Add playlists_team_share_read — covers the playlist_shares (multi-team) path
--      which previously had no playlists-level policy.
--   2. Drop playlists_org_read — too broad; team-based policies cover all valid cases.
--   3. Drop playlist_clips_org_read — same reason; clip access is covered by
--      playlist_clips_team_read (legacy) and playlist_clips_shared_team_read (shares).

-- 1. Allow team members to read playlists shared to their team via playlist_shares
CREATE POLICY playlists_team_share_read ON playlists
  FOR SELECT USING (
    id IN (
      SELECT playlist_id FROM playlist_shares
      WHERE team_id IN (SELECT current_user_team_ids())
    )
  );

-- 2. Remove the overly-broad org-level playlist policy
DROP POLICY IF EXISTS playlists_org_read ON playlists;

-- 3. Remove the overly-broad org-level clip policy
DROP POLICY IF EXISTS playlist_clips_org_read ON playlist_clips;
