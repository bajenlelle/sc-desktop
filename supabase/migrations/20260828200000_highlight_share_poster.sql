-- =============================================================================
-- Poster frames for highlight shares: the desktop app extracts a JPEG frame
-- from the rendered MP4 and uploads it beside the video
-- (highlights/{userId}/{shareId}.jpg), so the public /h/{id} page can show
-- real footage in its OG image and <video poster>.
--
-- Nullable on purpose: rows created before this ships, and shares reused by
-- the send-to-phone dialog (which never re-renders), have no poster — the
-- web page falls back to its generated branded card. The .jpg inherits the
-- R2 lifecycle rule and the delete-account prefix sweep via the
-- highlights/ prefix.
-- =============================================================================

ALTER TABLE highlight_shares
  ADD COLUMN poster_url text,
  ADD COLUMN poster_key text;

CREATE OR REPLACE FUNCTION get_highlight_share(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row highlight_shares;
BEGIN
  SELECT * INTO v_row FROM highlight_shares WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'title', v_row.title,
    'url', v_row.r2_url,
    'poster_url', v_row.poster_url,
    'created_at', v_row.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_highlight_share(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_highlight_share(uuid) TO authenticated;
