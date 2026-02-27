-- =============================================================================
-- Replace playlists.clips JSONB with a proper playlist_clips relational table
--
-- Why:
--   • Enforces FK integrity between clips and matches (ON DELETE CASCADE)
--   • Row-level mutations instead of full-array rewrites
--   • Enables pagination / partial loads in the future
--   • Supports individual clip indexing
-- =============================================================================

-- 1. Create the relational table
CREATE TABLE playlist_clips (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  playlist_id      uuid    NOT NULL REFERENCES playlists(id)  ON DELETE CASCADE,
  match_id         text    NOT NULL REFERENCES matches(id)    ON DELETE CASCADE,
  event_id         bigint  NOT NULL,
  position         integer NOT NULL DEFAULT 0,   -- explicit display order
  pre_roll_offset  numeric(5,2) NOT NULL DEFAULT 0,
  post_roll_offset numeric(5,2) NOT NULL DEFAULT 0,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Fetch clips in display order for a playlist (most common query)
CREATE INDEX idx_playlist_clips_playlist ON playlist_clips (playlist_id, position);
-- Allow efficient cleanup when a match is listed/deleted
CREATE INDEX idx_playlist_clips_match    ON playlist_clips (match_id);
-- Prevent duplicate clips: one entry per event per playlist
ALTER TABLE playlist_clips
  ADD CONSTRAINT uq_playlist_clip UNIQUE (playlist_id, match_id, event_id);

-- 2. Row-Level Security
ALTER TABLE playlist_clips ENABLE ROW LEVEL SECURITY;

-- Access is granted iff the parent playlist belongs to the current user.
-- (SELECT auth.uid()) is evaluated once per statement for efficiency.
CREATE POLICY "playlist_clips_owner"
  ON playlist_clips FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM playlists
      WHERE playlists.id = playlist_id
        AND playlists.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM playlists
      WHERE playlists.id = playlist_id
        AND playlists.user_id = (SELECT auth.uid())
    )
  );

-- 3. Migrate existing clips from the JSONB column
--    Skip orphaned clips whose match no longer exists (avoids FK violation).
INSERT INTO playlist_clips
  (playlist_id, match_id, event_id, position, pre_roll_offset, post_roll_offset, note)
SELECT
  p.id                                                           AS playlist_id,
  clip->>'matchId'                                               AS match_id,
  (clip->>'eventId')::bigint                                     AS event_id,
  (row_number() OVER (PARTITION BY p.id ORDER BY ordinality) - 1)::integer
                                                                 AS position,
  COALESCE((clip->>'preRollOffset')::numeric, 0)                AS pre_roll_offset,
  COALESCE((clip->>'postRollOffset')::numeric, 0)               AS post_roll_offset,
  clip->>'note'                                                  AS note
FROM playlists p,
     jsonb_array_elements(p.clips) WITH ORDINALITY AS t(clip, ordinality)
WHERE jsonb_array_length(p.clips) > 0
  AND clip->>'matchId'  IS NOT NULL
  AND clip->>'eventId'  IS NOT NULL
  AND EXISTS (SELECT 1 FROM matches WHERE matches.id = clip->>'matchId')
ON CONFLICT (playlist_id, match_id, event_id) DO NOTHING;

-- 4. Drop the JSONB column — no longer needed
ALTER TABLE playlists DROP COLUMN IF EXISTS clips;
