-- =============================================================================
-- Enforce share scope: owners only, club orgs only, recipients inside the club
--
-- Two problems, one fix.
--
-- 1. Cross-tenant read hole. playlist_user_shares_owner checked only
--    `shared_by = auth.uid()` on write — never that the sharer owns the
--    playlist — while current_user_visible_playlist_ids() grants read on every
--    playlist that has a direct-share row naming the caller, whoever wrote the
--    row. Any signed-in user who knew a playlist's UUID could insert
--    (playlist_id, user_id = self, shared_by = self) and read another club's
--    playlist, clips and play-by-play. UUIDs travel in URLs and deep links;
--    they are not a secret.
--
-- 2. Sharing is club-shaped — it is what the Franchise licence sells — but only
--    the clients said so. The desktop picker offers only members of the
--    sharer's teams, and teams exist only in club orgs, yet the database took a
--    share of any playlist, from any org, to anyone. App Review (3.1.1 /
--    3.1.3(c)) asks whether individual plans (Rookie, Pro) reach content in the
--    iOS app. They don't; after this migration the database guarantees it.
--
-- Also: the licence lock now covers direct shares too, as LicenseNotice already
-- promises ("New shares are paused"). enforce_license_on_share only ever
-- guarded team shares.
--
-- Prod audit 2026-09-29, before this migration: 142 playlists, none with
-- org_id NULL (so NULL keeps its documented meaning — the owner's personal
-- space — and is treated as not-a-club); 7 direct + 28 team shares, of which 0
-- were written by a non-owner, 0 came from a personal org, 0 went to a
-- recipient outside the playlist's org, and 0 crossed orgs. Every client share
-- path is owner-gated (`createdBy === currentUserId`, getMySharedPlaylists),
-- which also makes the "a coach can share a playlist they didn't create" note
-- in _notify_user_share out of date. The rules below describe existing data
-- exactly, so nothing is backfilled or removed.
--
-- Read policies are untouched; every check here runs on writes only.
-- Guards follow playlists_check_folder_org, and are named to sort before the
-- *_notify triggers so a rejected share never reaches the notification path
-- (pg_net would roll the queued push/email back regardless).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Direct-share writes require owning the playlist. Mirrors
--    playlist_shares_owner; USING is unchanged, so reads stay identical.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS playlist_user_shares_owner ON playlist_user_shares;
CREATE POLICY playlist_user_shares_owner ON playlist_user_shares FOR ALL
  USING (shared_by = (SELECT auth.uid()))
  WITH CHECK (
    shared_by = (SELECT auth.uid())
    AND playlist_id IN (SELECT current_user_owned_playlist_ids())
  );

-- ---------------------------------------------------------------------------
-- 2. The club org a playlist belongs to, or NULL when it sits in a personal
--    space (or has no org at all). Internal helper for the guards below — not
--    an RPC, so it isn't exposed to clients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _playlist_club_org(p_playlist_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.org_id
    FROM playlists p
    JOIN organizations o ON o.id = p.org_id
   WHERE p.id = p_playlist_id
     AND NOT COALESCE(o.is_personal, false);
$$;

REVOKE EXECUTE ON FUNCTION _playlist_club_org(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Direct shares: from a club playlist, to a member of that club, while its
--    licence isn't locked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playlist_user_shares_check_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Clients sync recipients with upsert, which re-inserts every current row;
  -- only genuinely new shares are checked (enforce_license_on_share's rule),
  -- so a recipient who has since left the club can't wedge every later
  -- re-sync of the playlist, and unsharing keeps working while locked.
  IF EXISTS (
    SELECT 1 FROM playlist_user_shares
    WHERE playlist_id = new.playlist_id AND user_id = new.user_id
  ) THEN
    RETURN new;
  END IF;

  v_org_id := _playlist_club_org(new.playlist_id);
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'playlist_not_in_club';
  END IF;

  IF org_license_state(v_org_id) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE org_id = v_org_id AND user_id = new.user_id
  ) THEN
    RAISE EXCEPTION 'recipient_not_in_org';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS playlist_user_shares_guard ON playlist_user_shares;
CREATE TRIGGER playlist_user_shares_guard
  BEFORE INSERT ON playlist_user_shares
  FOR EACH ROW EXECUTE FUNCTION playlist_user_shares_check_scope();

-- ---------------------------------------------------------------------------
-- 4. Team shares: from a club playlist, to a team of that same club. The
--    licence check stays in trg_enforce_license_on_share.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playlist_shares_check_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM playlist_shares
    WHERE playlist_id = new.playlist_id AND team_id = new.team_id
  ) THEN
    RETURN new;
  END IF;

  v_org_id := _playlist_club_org(new.playlist_id);
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'playlist_not_in_club';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM teams WHERE id = new.team_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_playlist_org';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS playlist_shares_guard ON playlist_shares;
CREATE TRIGGER playlist_shares_guard
  BEFORE INSERT ON playlist_shares
  FOR EACH ROW EXECUTE FUNCTION playlist_shares_check_scope();

-- ---------------------------------------------------------------------------
-- 5. The legacy playlists.team_id column is a share channel too
--    (playlists_read grants read by it). setPlaylistTeams keeps it pointing at
--    a same-club team; hold it to that. Checked only when team_id is set or
--    changed, so untouched legacy rows and unrelated updates never trip it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playlists_check_team_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF new.team_id IS NULL
     OR (TG_OP = 'UPDATE' AND new.team_id IS NOT DISTINCT FROM old.team_id) THEN
    RETURN new;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM teams t
      JOIN organizations o ON o.id = t.org_id
     WHERE t.id = new.team_id
       AND t.org_id = new.org_id
       AND NOT COALESCE(o.is_personal, false)
  ) THEN
    RAISE EXCEPTION 'team_not_in_playlist_org';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS playlists_team_org_guard ON playlists;
CREATE TRIGGER playlists_team_org_guard
  BEFORE INSERT OR UPDATE OF team_id ON playlists
  FOR EACH ROW EXECUTE FUNCTION playlists_check_team_org();
