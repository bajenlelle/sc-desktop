-- =============================================================================
-- Per-clip watch tracking for shared playlists.
--
-- Players receive playlists from their coaches and need to know what's new
-- and how far through a playlist they are. Nothing recorded that until now,
-- so "unwatched" was unanswerable on the player side and coaches had no way
-- to tell whether a shared playlist had actually been watched.
--
-- Granularity is per clip rather than per playlist so progress bars,
-- resume-where-you-left-off, and per-clip completion for the coach-facing
-- view all work off the same rows.
-- =============================================================================

CREATE TABLE clip_views (
  user_id     uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playlist_id uuid   NOT NULL REFERENCES playlists(id)  ON DELETE CASCADE,
  match_id    text   NOT NULL REFERENCES matches(id)    ON DELETE CASCADE,
  event_id    bigint NOT NULL,
  watched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, playlist_id, match_id, event_id)
);

-- Progress lookups are always "this player, this playlist".
CREATE INDEX clip_views_playlist_user_idx ON clip_views (playlist_id, user_id);

ALTER TABLE clip_views ENABLE ROW LEVEL SECURITY;

-- A player reads and writes only their own view history.
CREATE POLICY clip_views_own ON clip_views
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- The playlist owner may READ views on their own playlist. Added now so the
-- coach-facing "who watched what" surface needs no follow-up migration.
CREATE POLICY clip_views_owner_read ON clip_views
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = clip_views.playlist_id
      AND p.user_id = (SELECT auth.uid())
  ));
