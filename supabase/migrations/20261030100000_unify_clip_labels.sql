-- One kind of clip label.
--
-- A label used to come in two kinds: a bank label on the clip itself
-- (playlist_id IS NULL, shown in the Add clips browser) and a playlist label
-- that lived inside one playlist (playlist_id set). A label on a clip now
-- means the same thing everywhere, so every playlist label becomes a plain
-- label on its clip: the union of what the coach had put on it anywhere.
-- A label that was on the same clip in two playlists, or already on the clip
-- itself, becomes one row (cla_unique_bank), keeping the earliest date.
--
-- The column stays for one release: desktop builds before 1.3.0 still write
-- playlist_id, and dropping it would fail their label actions until they
-- update. A later migration drops it, the partial indexes and the scope
-- clauses in move_to_club, after merging any rows those builds wrote.

INSERT INTO clip_label_assignments (user_id, org_id, match_id, event_id, label_id, assigned_at)
SELECT user_id, org_id, match_id, event_id, label_id, min(assigned_at)
FROM clip_label_assignments
WHERE playlist_id IS NOT NULL
GROUP BY user_id, org_id, match_id, event_id, label_id
ON CONFLICT DO NOTHING;

DELETE FROM clip_label_assignments WHERE playlist_id IS NOT NULL;
