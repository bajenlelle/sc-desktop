-- Add text card support to playlist_clips table.
-- item_type: 'clip' (default, existing rows) | 'text' (new text card rows)
-- item_id:   stable UUID for text cards (frontend-generated, stored as TEXT)
-- text_content: the display text for text cards
-- duration_seconds: how long the text card is shown (in-app and in export)

ALTER TABLE playlist_clips ADD COLUMN item_type TEXT NOT NULL DEFAULT 'clip';
ALTER TABLE playlist_clips ADD COLUMN item_id TEXT;
ALTER TABLE playlist_clips ADD COLUMN text_content TEXT;
ALTER TABLE playlist_clips ADD COLUMN duration_seconds REAL;

-- Unique index for fast text card lookups / deduplication.
CREATE UNIQUE INDEX playlist_clips_text_card_key
  ON playlist_clips(playlist_id, item_id)
  WHERE item_id IS NOT NULL;
