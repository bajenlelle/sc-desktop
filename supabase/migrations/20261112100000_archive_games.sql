-- Archive a game: a coach archives the games they are done with, so the desktop's Library, Home
-- and Add clips stay short. NULL = in the library; a time = archived then.
-- Archiving only sets the time: the row, its plays, its playlist clips, its label assignments and
-- its shares stay untouched (deleting a game cascades, archiving doesn't).
-- Inherits the table's RLS and grants: the owner writes it through matches_owner, and matches has
-- no column-level grants. Released apps select "*" and ignore it; web and mobile never filter on
-- it. move_to_club only updates org_id, so a moved game keeps its archive state, and a club copy
-- that absorbs a personal one keeps its own. A re-import clears it
-- (packages/shared/lib/genius-import.ts).
ALTER TABLE matches ADD COLUMN archived_at timestamptz;
COMMENT ON COLUMN matches.archived_at IS 'When the owner archived the game (hidden from the desktop Library, Home and Add clips); NULL = in the library';
