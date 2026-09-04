-- A playlist whose folder resolved to a different org during the org-scope
-- backfill keeps its own (clip-derived) org and simply becomes unfiled —
-- the folder isn't visible in that space, and silently reparenting content
-- across spaces would be worse. One row today; idempotent for future sweeps.
UPDATE playlists p
SET folder_id = NULL
FROM playlist_folders f
WHERE p.folder_id = f.id
  AND p.org_id IS DISTINCT FROM f.org_id;
