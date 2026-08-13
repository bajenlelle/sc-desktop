-- Ordering-lock groups for playlist items (Johannes #7: lock clips so they
-- move together). group_id is a frontend-generated UUID stored as text (same
-- convention as item_id). NULL = ungrouped. Contiguity — group members sitting
-- at consecutive positions — is an app-level invariant maintained by the
-- desktop editor; groups carry no meaning for playback/export/watch views.
ALTER TABLE playlist_clips ADD COLUMN group_id text;

-- Extend the reorder RPC to also persist group membership. Every reorder call
-- sends the full item list, and v_item->>'group_id' is NULL when the key is
-- absent, so each call fully rewrites membership — group/ungroup need no
-- dedicated RPC.
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
         SET position = (v_item->>'position')::integer,
             group_id = (v_item->>'group_id')
       WHERE playlist_id = p_playlist_id
         AND item_id     = (v_item->>'item_id');
    ELSE
      UPDATE playlist_clips
         SET position = (v_item->>'position')::integer,
             group_id = (v_item->>'group_id')
       WHERE playlist_id = p_playlist_id
         AND match_id    = (v_item->>'match_id')
         AND event_id    = (v_item->>'event_id')::bigint;
    END IF;
  END LOOP;
END;
$$;
