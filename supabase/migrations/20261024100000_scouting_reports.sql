-- Scouting reports: a playlist with player cards, published as one public,
-- unlisted page (packages/shared/lib/scouting-report.ts builds it, the web
-- app's /r/<id> shows it).
--
--   1. Player cards: playlist_clips.item_type 'player', the spec in `card`.
--   2. reorder_playlist_items carries a player card like a text card.
--   3. scouting_reports: the snapshot a coach publishes, behind an unguessable
--      id (the highlight_shares pattern: owner-only RLS, one anon RPC).
--   4. publish / revoke / get, and what keeps a report's clip files alive.
--   5. Cleanup: a deleted playlist turns its report off; expired and revoked
--      rows are swept a week later.
--
-- A player card is NOT a text item. A build that doesn't know player cards
-- draws a text item's fallback line as a card in every shared playlist, and the
-- mobile builds in the stores can't be fixed over the air. Such a build drops a
-- row of an unknown item_type (its clip branch needs a match_id), so it sees
-- nothing. The row's text_content is an inert label ("#7 Alva Berg").

-- ---------------------------------------------------------------------------
-- 1. Player cards
-- ---------------------------------------------------------------------------
-- A text item may carry a stats card spec, a player item must carry a player
-- card spec, a clip carries neither. The 16 KB cap stays: a note is at most
-- 2000 characters and the stats snapshot is a few hundred bytes.
ALTER TABLE public.playlist_clips
  DROP CONSTRAINT IF EXISTS playlist_clips_card_check;

ALTER TABLE public.playlist_clips
  ADD CONSTRAINT playlist_clips_card_check CHECK (
    (
      item_type = 'player'
      AND card IS NOT NULL
      AND jsonb_typeof(card) = 'object'
      AND card->>'type' = 'player'
      AND octet_length(card::text) <= 16384
    )
    OR (
      item_type <> 'player'
      AND (
        card IS NULL
        OR (
          item_type = 'text'
          AND jsonb_typeof(card) = 'object'
          AND octet_length(card::text) <= 16384
        )
      )
    )
  );

COMMENT ON COLUMN public.playlist_clips.card IS
  'Card spec: a stats card on a text item (lib/stats-card.ts), a player card on a player item (lib/player-card.ts). NULL on a plain text card or a clip.';

-- ---------------------------------------------------------------------------
-- 2. Reordering carries player cards
-- ---------------------------------------------------------------------------
-- Same body as 20260816000000, with 'player' handled like 'text': both are
-- addressed by item_id. Privileges are unchanged (CREATE OR REPLACE keeps them).
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
    IF (v_item->>'item_type') IN ('text', 'player') THEN
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

-- ---------------------------------------------------------------------------
-- 3. The published report
-- ---------------------------------------------------------------------------
-- `content` is the ScoutingReport snapshot (only a game's owner can read the
-- plays it is built from, and the page is anonymous). It holds storage KEYS,
-- never URLs: publish_scouting_report checks their shapes, and the page adds
-- the media host, so a coach can't point a report at an arbitrary address.
-- `clip_keys` is derived from the content here, never taken from the client.
--
-- playlist_id is SET NULL on delete, but a trigger (section 5) revokes the
-- report first: a link nobody can switch off must not outlive its playlist.
CREATE TABLE scouting_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playlist_id  uuid REFERENCES playlists(id) ON DELETE SET NULL,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  content      jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 262144),
  content_key  text NOT NULL CHECK (char_length(content_key) BETWEEN 1 AND 64),
  clip_keys    text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at   timestamptz
);

-- One live report per playlist: publishing again updates it in place, so a
-- link already pasted into a staff group keeps working.
CREATE UNIQUE INDEX scouting_reports_live_playlist_idx
  ON scouting_reports (playlist_id)
  WHERE revoked_at IS NULL AND playlist_id IS NOT NULL;
CREATE INDEX scouting_reports_user_idx ON scouting_reports (user_id);
CREATE INDEX scouting_reports_clip_keys_idx ON scouting_reports USING gin (clip_keys);

-- The owner reads their own rows (the dialog's "shared until", "up to date");
-- everything else goes through the functions below.
ALTER TABLE scouting_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY scouting_reports_owner_read ON scouting_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Data API grants (20261023100000): the apps read the owner's rows; nothing
-- writes from a client; the service role works the table; anon never touches it.
GRANT SELECT ON scouting_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scouting_reports TO service_role;
REVOKE ALL ON scouting_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON scouting_reports FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. Publish, revoke, read
-- ---------------------------------------------------------------------------
-- Publishes the caller's playlist, or updates its live report in place (same
-- id, a fresh 30 days). Returns {id, expires_at, created}.
--
--   not_authenticated, not_owner, license_locked (the playlist's club is past
--   its grace, like every share), upgrade_required (the playlist's plan is
--   free, as for an MP4 export), invalid_content.
--
-- What invalid_content means: version 1, an array of at most 60 sections each
-- with an array of blocks, at most 300 clips, every clip key a shipped clip
-- file's key and every poster key one of the caller's own highlights/<user>/
-- <uuid>.jpg files.
CREATE OR REPLACE FUNCTION publish_scouting_report(
  p_playlist_id uuid,
  p_title       text,
  p_content     jsonb,
  p_content_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_title     text := btrim(COALESCE(p_title, ''));
  v_org       uuid;
  v_clip_keys text[];
  v_bad       integer;
  v_id        uuid;
  v_expires   timestamptz;
  v_created   boolean;
  v_clip_re   constant text := '^clips/[A-Za-z0-9-]{1,64}/[0-9]{1,12}_pre-?[0-9]{1,4}\.[0-9]_post-?[0-9]{1,4}\.[0-9](_s[0-9]{1,6}\.[0-9])?\.mp4$';
  v_uuid      constant text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM playlists WHERE id = p_playlist_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  v_org := _playlist_club_org(p_playlist_id);
  IF v_org IS NOT NULL AND org_license_state(v_org) = 'locked' THEN
    RAISE EXCEPTION 'license_locked';
  END IF;

  IF _export_tier_for_playlist(p_playlist_id) = 'free' THEN
    RAISE EXCEPTION 'upgrade_required';
  END IF;

  -- Shape. The sections and their blocks are checked as arrays before they
  -- are expanded, so a malformed body is invalid_content, not a stray error.
  IF char_length(v_title) NOT BETWEEN 1 AND 120
     OR p_content_key IS NULL OR char_length(p_content_key) NOT BETWEEN 1 AND 64
     OR p_content IS NULL OR jsonb_typeof(p_content) <> 'object'
     OR octet_length(p_content::text) > 262144
     OR p_content->>'v' IS DISTINCT FROM '1'
     OR jsonb_typeof(p_content->'header') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_content->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_content->'sections') > 60 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s
   WHERE jsonb_typeof(s) IS DISTINCT FROM 'object'
      OR jsonb_typeof(s->'blocks') IS DISTINCT FROM 'array';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  -- Clips: at most 300, each with a key of the shape presign-upload admits.
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip';
  IF v_bad > 300 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip'
     AND (jsonb_typeof(b->'clipKey') IS DISTINCT FROM 'string' OR (b->>'clipKey') !~ v_clip_re);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  -- Posters: absent, null, or the caller's own highlights/<user>/<uuid>.jpg.
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip'
     AND (b ? 'posterKey')
     AND jsonb_typeof(b->'posterKey') <> 'null'
     AND (jsonb_typeof(b->'posterKey') <> 'string'
          OR (b->>'posterKey') !~ ('^highlights/' || v_uid::text || '/' || v_uuid || '\.jpg$'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b->>'clipKey'), '{}') INTO v_clip_keys
    FROM jsonb_array_elements(p_content->'sections') s,
         jsonb_array_elements(s->'blocks') b
   WHERE b->>'kind' = 'clip';

  INSERT INTO scouting_reports AS r (user_id, playlist_id, title, content, content_key, clip_keys, expires_at)
  VALUES (v_uid, p_playlist_id, v_title, p_content, p_content_key, v_clip_keys, now() + interval '30 days')
  ON CONFLICT (playlist_id) WHERE revoked_at IS NULL AND playlist_id IS NOT NULL
  DO UPDATE SET title       = EXCLUDED.title,
                content     = EXCLUDED.content,
                content_key = EXCLUDED.content_key,
                clip_keys   = EXCLUDED.clip_keys,
                updated_at  = now(),
                expires_at  = EXCLUDED.expires_at
          WHERE r.user_id = v_uid
  RETURNING r.id, r.expires_at, (r.xmax = 0) INTO v_id, v_expires, v_created;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'expires_at', v_expires, 'created', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_scouting_report(uuid, text, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION publish_scouting_report(uuid, text, jsonb, text) FROM PUBLIC, anon;

-- Turns the caller's report off: the page, stats and notes are wiped at once
-- (the row stays a week so the link says "no longer shared"). The clip files are
-- the ones the playlists share, so they are only queued for the purge, which
-- deletes a key nothing references anymore. Revoking twice is a no-op.
CREATE OR REPLACE FUNCTION revoke_scouting_report(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_keys text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT clip_keys INTO v_keys
    FROM scouting_reports
   WHERE id = p_id AND user_id = v_uid AND revoked_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM scouting_reports WHERE id = p_id AND user_id = v_uid) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'not_found';
  END IF;

  UPDATE scouting_reports
     SET revoked_at = now(), updated_at = now(), content = '{}'::jsonb, clip_keys = '{}'
   WHERE id = p_id;

  PERFORM _queue_media_deletion(k, 'cleared') FROM unnest(v_keys) AS k;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_scouting_report(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION revoke_scouting_report(uuid) FROM PUBLIC, anon;

-- The page's one anonymous read. The id is the capability (a random uuid), so
-- this returns the report or why it isn't one, and nothing else: no owner, no
-- playlist, no clip keys beyond the content.
CREATE OR REPLACE FUNCTION get_scouting_report(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row scouting_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM scouting_reports WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;
  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'title', v_row.title,
    'updated_at', v_row.updated_at,
    'expires_at', v_row.expires_at,
    'content', v_row.content
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_scouting_report(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_scouting_report(uuid) TO authenticated;

-- A live report keeps its clip files: the nightly purge deletes a queued key
-- only when nothing references it, and a coach who trims a clip after
-- publishing queues the old file. Re-created from 20261022100000 with the
-- third reference.
CREATE OR REPLACE FUNCTION _media_key_referenced(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM playlist_clips c
            WHERE c.r2_url IS NOT NULL
              AND right(c.r2_url, length(p_key) + 1) = '/' || p_key)
      OR EXISTS (
           SELECT 1 FROM render_jobs j
            WHERE j.kind = 'ship'
              AND j.status IN ('queued', 'running')
              AND jsonb_typeof(j.params->'clips') = 'array'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(j.params->'clips') e WHERE e->>'key' = p_key))
      OR EXISTS (
           SELECT 1 FROM scouting_reports r
            WHERE r.revoked_at IS NULL
              AND r.expires_at > now()
              AND p_key = ANY (r.clip_keys));
$$;
REVOKE ALL ON FUNCTION _media_key_referenced(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cleanup
-- ---------------------------------------------------------------------------
-- Deleting a playlist turns its live report off first. SECURITY DEFINER like
-- queue_superseded_clip_file: the delete runs as the user over PostgREST, and
-- the user has no right to write the queue. Housekeeping never blocks the delete.
CREATE OR REPLACE FUNCTION revoke_scouting_report_on_playlist_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _queue_media_deletion(k, 'cleared')
     FROM (SELECT unnest(clip_keys) AS k
             FROM scouting_reports
            WHERE playlist_id = OLD.id AND revoked_at IS NULL) q;
  UPDATE scouting_reports
     SET revoked_at = now(), updated_at = now(), content = '{}'::jsonb, clip_keys = '{}'
   WHERE playlist_id = OLD.id AND revoked_at IS NULL;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[scouting-report] revoke on playlist delete failed: %', SQLERRM;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION revoke_scouting_report_on_playlist_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revoke_scouting_report_on_playlist_delete
  BEFORE DELETE ON playlists
  FOR EACH ROW EXECUTE FUNCTION revoke_scouting_report_on_playlist_delete();

-- Rows a week past their expiry or revocation are deleted, and the clip files
-- they held queued for the purge (which re-checks references). Called by cron.
CREATE OR REPLACE FUNCTION run_scouting_report_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  PERFORM _queue_media_deletion(k, 'cleared')
     FROM (SELECT unnest(clip_keys) AS k
             FROM scouting_reports
            WHERE expires_at < now() - interval '7 days'
               OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')) q;
  DELETE FROM scouting_reports
   WHERE expires_at < now() - interval '7 days'
      OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[scouting-report] run_scouting_report_sweep failed: %', SQLERRM;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION run_scouting_report_sweep() FROM PUBLIC, anon, authenticated;

-- 04:30 UTC daily (idempotent; no-op where pg_cron isn't installed, e.g. local dev).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'scouting-report-sweep';
    PERFORM cron.schedule('scouting-report-sweep', '30 4 * * *', 'SELECT run_scouting_report_sweep()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — schedule scouting-report-sweep manually';
  END IF;
END;
$$;
