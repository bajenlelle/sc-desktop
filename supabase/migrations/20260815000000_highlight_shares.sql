-- =============================================================================
-- "Send to phone": a rendered highlight MP4 hosted on R2 behind an
-- unguessable share id, viewable on a public page (/h/{id}) so the player's
-- phone can save/share it natively.
--
-- The uuid PK is the share token (122 random bits — the org_invites-style
-- short code exists only for human-typeable codes, which this isn't).
-- Links expire after 30 days; a Cloudflare R2 lifecycle rule on the
-- highlights/ prefix cleans the files themselves (~35 days, small grace).
-- =============================================================================

CREATE TABLE highlight_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playlist_id uuid REFERENCES playlists(id) ON DELETE SET NULL,
  title       text NOT NULL,
  r2_url      text NOT NULL,
  r2_key      text NOT NULL,
  clip_count  integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE INDEX idx_highlight_shares_user ON highlight_shares (user_id, created_at DESC);

-- Owner-only, self-contained (no cross-table policy queries — this schema
-- has a history of RLS recursion when policies join org tables).
ALTER TABLE highlight_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY highlight_shares_own ON highlight_shares
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Public read goes through a curated projection, not an anon RLS policy —
-- same pattern as get_invite_preview (the only other anon surface).
CREATE FUNCTION get_highlight_share(p_id uuid)
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
    'created_at', v_row.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_highlight_share(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_highlight_share(uuid) TO authenticated;
