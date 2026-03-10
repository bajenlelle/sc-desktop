-- Text cards have no associated match or event.
-- Drop the NOT NULL constraints so text card rows (item_type = 'text')
-- can leave match_id and event_id as NULL.
ALTER TABLE playlist_clips ALTER COLUMN match_id DROP NOT NULL;
ALTER TABLE playlist_clips ALTER COLUMN event_id DROP NOT NULL;
