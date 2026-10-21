-- =============================================================================
-- A removed clip's file goes to the purge queue too.
--
-- 20261022100000 queues a shipped clip's file when its row stops pointing at it
-- (a re-cut, a trim, a sync change). A row that is DELETED (a clip taken out of
-- a playlist, a playlist deleted, an account deleted: the cascades) left its
-- file in the public media bucket for good. Now it is queued as well, reason
-- 'removed'. Nothing else changes: the nightly media_purge deletes a key only
-- when no playlist clip, live ship job or live scouting report still points at
-- it (_media_key_referenced), so a file two playlists share stays while either
-- one has it, and only inside the project's MEDIA_PURGE_SCOPE.
-- =============================================================================

-- 1. The queue takes the new reason.
ALTER TABLE media_deletions DROP CONSTRAINT media_deletions_reason_check;
ALTER TABLE media_deletions ADD CONSTRAINT media_deletions_reason_check
  CHECK (reason IN ('replaced', 'cleared', 'removed'));

-- Re-created from 20261022100000: 'removed' kept as given; anything else as before.
CREATE OR REPLACE FUNCTION _queue_media_deletion(p_key text, p_reason text DEFAULT 'replaced')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL
     OR p_key !~ '^clips/[A-Za-z0-9-]{1,64}/[0-9]{1,12}_pre-?[0-9]{1,4}\.[0-9]_post-?[0-9]{1,4}\.[0-9](_s[0-9]{1,6}\.[0-9])?\.mp4$' THEN
    RETURN false;
  END IF;
  INSERT INTO media_deletions (storage_key, reason)
  VALUES (p_key, CASE WHEN p_reason IN ('cleared', 'removed') THEN p_reason ELSE 'replaced' END)
  ON CONFLICT (storage_key) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION _queue_media_deletion(text, text) FROM PUBLIC, anon, authenticated;

-- 2. A deleted row queues the file it pointed at. SECURITY DEFINER like
-- queue_superseded_clip_file: a coach removes a clip as themselves over
-- PostgREST and has no right to write the queue. Housekeeping never fails the
-- delete.
CREATE OR REPLACE FUNCTION queue_removed_clip_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _queue_media_deletion(_media_clip_key(OLD.r2_url), 'removed');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[game-video] queue_removed_clip_file failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION queue_removed_clip_file() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_queue_removed_clip_file
  AFTER DELETE ON playlist_clips
  FOR EACH ROW
  WHEN (OLD.r2_url IS NOT NULL)
  EXECUTE FUNCTION queue_removed_clip_file();
