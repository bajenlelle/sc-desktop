-- =============================================================================
-- Add scope (playlist_id) to clip_label_assignments.
--
-- Two-tier model:
--   * Bank scope     — playlist_id IS NULL — clip "what is it" tags, visible
--                      in the Add-Clips browser. Persist across all matches.
--   * Playlist scope — playlist_id = <id> — clip's role within a specific
--                      playlist. The same clip in two playlists can have two
--                      different label sets.
--
-- Vocabulary (the `labels` table) is unchanged: one shared library per
-- (user, org) used across both scopes.
-- =============================================================================

ALTER TABLE clip_label_assignments
  ADD COLUMN playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE;

-- Replace the composite PK with partial unique indexes. NULL = NULL is false
-- in SQL, so a single UNIQUE that includes a nullable column would allow
-- duplicates in the bank-scope rows.
ALTER TABLE clip_label_assignments
  DROP CONSTRAINT clip_label_assignments_pkey;

CREATE UNIQUE INDEX cla_unique_bank
  ON clip_label_assignments (user_id, org_id, match_id, event_id, label_id)
  WHERE playlist_id IS NULL;

CREATE UNIQUE INDEX cla_unique_playlist
  ON clip_label_assignments (user_id, org_id, match_id, event_id, label_id, playlist_id)
  WHERE playlist_id IS NOT NULL;

-- The playlist-scope fetch ("assignments for these clips in this playlist")
-- benefits from an index that includes playlist_id in the leading columns.
DROP INDEX IF EXISTS cla_clip_idx;
CREATE INDEX cla_clip_scope_idx
  ON clip_label_assignments (user_id, org_id, match_id, event_id, playlist_id);
