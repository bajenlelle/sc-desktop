-- =============================================================================
-- A playlist's clip length: seconds of video before and after each event.
--
-- Until now the pair lived only in the desktop editor's memory and reset to
-- 10 s / 3 s whenever the page opened, while each clip's own adjustment
-- (playlist_clips.pre_roll_offset / post_roll_offset, from nudges and trims)
-- is stored RELATIVE to the pair. A coach who changed the pair and then
-- adjusted clips saw every adjusted clip change length on their next visit.
--
-- NULL = the app default (10 s / 3 s), which is what every existing playlist
-- has effectively used, so there is no backfill. Released apps ignore the
-- columns. Writes go through the existing owner-only playlists_owner policy.
-- =============================================================================
ALTER TABLE playlists
  ADD COLUMN pre_roll  smallint CHECK (pre_roll  BETWEEN 0 AND 60),
  ADD COLUMN post_roll smallint CHECK (post_roll BETWEEN 0 AND 60);

COMMENT ON COLUMN playlists.pre_roll IS
  'Seconds of video before each event; NULL = app default (10). playlist_clips.pre_roll_offset is relative to this.';
COMMENT ON COLUMN playlists.post_roll IS
  'Seconds of video after each event; NULL = app default (3). playlist_clips.post_roll_offset is relative to this.';
