-- Drawings and slow motion on a clip (packages/shared/lib/clip-drawing.ts, clip-timeline.ts).
-- Times are anchored to the source video like crop_keyframes (20260909100000), so trims and
-- sync changes never move them off the frames they were made on. Inherits the table's owner
-- RLS; nullable and invisible to current apps (they select an explicit column list).
ALTER TABLE playlist_clips ADD COLUMN drawings jsonb, ADD COLUMN slow_motion jsonb;
ALTER TABLE playlist_clips ADD CONSTRAINT playlist_clips_drawings_check
  CHECK (drawings IS NULL OR (jsonb_typeof(drawings) = 'array' AND octet_length(drawings::text) <= 32768));
ALTER TABLE playlist_clips ADD CONSTRAINT playlist_clips_slow_motion_check
  CHECK (slow_motion IS NULL OR (jsonb_typeof(slow_motion) = 'array' AND octet_length(slow_motion::text) <= 4096));
COMMENT ON COLUMN playlist_clips.drawings IS 'Freeze-frame drawings on the clip; see packages/shared/lib/clip-drawing.ts';
COMMENT ON COLUMN playlist_clips.slow_motion IS 'Slow-motion sections of the clip; see packages/shared/lib/clip-timeline.ts';
