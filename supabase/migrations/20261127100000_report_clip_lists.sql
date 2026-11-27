-- A scouting report owns its clips (docs/scouting-reports.md, "The report's
-- clips"). They stay in `playlists` / `playlist_clips`, the one container the
-- app has for clips (trim, notes, drawings, uploads, the free-report rule,
-- club moves), but a report's container is not a playlist the coach sees:
-- it is `kind = 'report'`, left out wherever playlists are listed, and never
-- shared with players as a playlist (players get the report itself).
--
-- A report made before this, on a playlist the coach made, stays on that
-- playlist (`kind = 'playlist'`): nothing tells the two apart, so only the
-- reports started from a team (their draft names the team, desktop on
-- staging since 2026-11-22) become report containers.

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'playlist';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'playlists_kind_check') THEN
    ALTER TABLE playlists ADD CONSTRAINT playlists_kind_check CHECK (kind IN ('playlist', 'report'));
  END IF;
END $$;

COMMENT ON COLUMN playlists.kind IS
  'playlist: a playlist the coach sees and shares. report: a scouting report''s own clips, listed with Reports and never shared as a playlist.';

UPDATE playlists p
   SET kind = 'report'
  FROM scouting_report_drafts d
 WHERE d.playlist_id = p.id
   AND p.kind = 'playlist'
   AND jsonb_typeof(d.content -> 'team') = 'object';

-- ---------------------------------------------------------------------------
-- A report's clips never reach players as a playlist: no team share, no
-- direct share, no legacy team_id. Re-inserted rows (clients sync
-- recipients with upsert) are refused too, as a report container never had
-- any.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _refuse_report_playlist_share()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM playlists WHERE id = new.playlist_id AND kind = 'report') THEN
    RAISE EXCEPTION 'report_not_shareable';
  END IF;
  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION _refuse_report_playlist_share() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS playlist_shares_not_report ON playlist_shares;
CREATE TRIGGER playlist_shares_not_report
  BEFORE INSERT ON playlist_shares
  FOR EACH ROW EXECUTE FUNCTION _refuse_report_playlist_share();

DROP TRIGGER IF EXISTS playlist_user_shares_not_report ON playlist_user_shares;
CREATE TRIGGER playlist_user_shares_not_report
  BEFORE INSERT ON playlist_user_shares
  FOR EACH ROW EXECUTE FUNCTION _refuse_report_playlist_share();

-- The legacy team_id channel (playlists_read grants read by it), and a
-- shared playlist turned into a report container.
CREATE OR REPLACE FUNCTION _refuse_report_playlist_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF new.kind = 'report' AND new.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'report_not_shareable';
  END IF;
  IF new.kind = 'report' AND old.kind IS DISTINCT FROM 'report' AND (
    EXISTS (SELECT 1 FROM playlist_shares WHERE playlist_id = new.id)
    OR EXISTS (SELECT 1 FROM playlist_user_shares WHERE playlist_id = new.id)
  ) THEN
    RAISE EXCEPTION 'report_not_shareable';
  END IF;
  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION _refuse_report_playlist_team() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS playlists_report_not_shared ON playlists;
CREATE TRIGGER playlists_report_not_shared
  BEFORE UPDATE OF kind, team_id ON playlists
  FOR EACH ROW EXECUTE FUNCTION _refuse_report_playlist_team();
