-- =============================================================================
-- Import quota counts imports performed, not rows that still exist.
--
-- Previously count_club_matches_this_month counted live `matches` rows, so
-- deleting a game refunded the monthly import. The append-only import_log
-- survives deletion; UNIQUE (user_id, match_id) means re-importing the same
-- game is free (it was already paid for), while each new game counts.
-- =============================================================================

CREATE TABLE import_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     uuid,
  match_id   text NOT NULL,          -- no FK: must outlive the match row
  league_id  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);

CREATE INDEX idx_import_log_user_month ON import_log (user_id, created_at DESC);

-- Rows are written only by the trigger below (SECURITY DEFINER); users may
-- read their own.
ALTER TABLE import_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_log_select_own ON import_log
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- Log every real import at the source — client code can't forget to.
-- Seeded sample games (is_demo) never count.
CREATE FUNCTION log_match_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.is_demo THEN
    INSERT INTO import_log (user_id, org_id, match_id, league_id, created_at)
    VALUES (NEW.user_id, NEW.org_id, NEW.id, NEW.league_id, NEW.created_at)
    ON CONFLICT (user_id, match_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER matches_log_import
  AFTER INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION log_match_import();

-- Backfill so this month's usage carries over (demo copies excluded).
INSERT INTO import_log (user_id, org_id, match_id, league_id, created_at)
SELECT user_id, org_id, id, league_id, created_at
FROM matches
WHERE NOT is_demo
ON CONFLICT (user_id, match_id) DO NOTHING;

-- Count the log, not live rows.
CREATE OR REPLACE FUNCTION count_club_matches_this_month(
  p_nt_league_ids text[] DEFAULT '{}',
  p_org_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::integer FROM import_log
  WHERE user_id = auth.uid()
    AND created_at >= date_trunc('month', now())
    AND (p_org_id IS NULL OR org_id = p_org_id)
    AND (league_id IS NULL OR NOT (league_id = ANY(p_nt_league_ids)));
$$;
