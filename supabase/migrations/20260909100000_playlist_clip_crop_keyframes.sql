-- Per-clip crop keyframes for vertical (9:16) export.
--
-- Shape: [{"t": <absolute source-video seconds>, "cx": <0..1 normalized
-- crop-window center>}, ...]. Times are anchored to the source video (not
-- the clip window) so pre/post-roll changes never desync the pan. NULL or
-- empty = static centered crop. Written by the desktop crop editor;
-- designed to be tracker-fillable later (auto-follow) without a schema
-- change. Inherits playlist_clips' owner RLS — no policy changes needed
-- (same pattern as group_id, 20260816000000).
ALTER TABLE playlist_clips ADD COLUMN IF NOT EXISTS crop_keyframes jsonb;
