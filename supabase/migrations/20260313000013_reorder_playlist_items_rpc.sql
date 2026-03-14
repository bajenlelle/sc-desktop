-- Atomically update positions for all items in a playlist in a single round-trip.
-- p_items is a JSONB array of:
--   { "item_type": "clip",  "match_id": "...", "event_id": 123, "position": 0 }
--   { "item_type": "text",  "item_id":  "...",                  "position": 1 }
CREATE OR REPLACE FUNCTION reorder_playlist_items(
  p_playlist_id uuid,
  p_items       jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb;
BEGIN
  -- Verify caller owns the playlist
  IF NOT EXISTS (
    SELECT 1 FROM playlists
    WHERE id = p_playlist_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'item_type') = 'text' THEN
      UPDATE playlist_clips
         SET position = (v_item->>'position')::integer
       WHERE playlist_id = p_playlist_id
         AND item_id     = (v_item->>'item_id');
    ELSE
      UPDATE playlist_clips
         SET position = (v_item->>'position')::integer
       WHERE playlist_id = p_playlist_id
         AND match_id    = (v_item->>'match_id')
         AND event_id    = (v_item->>'event_id')::bigint;
    END IF;
  END LOOP;
END;
$$;
