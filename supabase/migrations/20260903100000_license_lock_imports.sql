-- =============================================================================
-- 20260903100000: Importing games pauses when a club license is locked
--
-- Completes the grace-lock write set from 20260902100000 (playlist_shares,
-- create_team_for_org, assign_member_to_team): past expiry + grace, new game
-- imports into the org are blocked too. Personal orgs never expire
-- (expires_at stays NULL), so personal-space imports are unaffected.
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_license_on_import()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- saveMatch upserts: re-saving an existing match (sync point, video attach,
  -- event refresh) re-inserts the row — only genuinely NEW imports are blocked.
  IF EXISTS (SELECT 1 FROM matches WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF NEW.org_id IS NOT NULL AND org_license_state(NEW.org_id) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_on_import ON matches;
CREATE TRIGGER trg_enforce_license_on_import
  BEFORE INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION enforce_license_on_import();
