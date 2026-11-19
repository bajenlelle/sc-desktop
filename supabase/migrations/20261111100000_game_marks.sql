-- A game's marks from the league's play-by-play (packages/shared/lib/game-marks.ts): its
-- timeouts and each period's start and end on the wall clock. The import keeps only the plays
-- that can become clips, so these were dropped; the desktop's game view (docs/game-view.md)
-- marks them on the game's timeline and filters the plays after a timeout by them.
-- jsonb on the game, not rows in play_by_play_events: every released app lists each row of that
-- table as a play. NULL = not read yet; the game view fills it the first time the game is
-- opened, from the genius function's cached feed. No backfill here.
-- Inherits the table's RLS and grants: the owner writes through matches_owner, and matches has
-- no column-level grants. Released apps select "*" and ignore it. move_to_club is unchanged: a
-- moved game keeps its row, and a club copy that absorbs a personal one keeps or reads its own.
ALTER TABLE matches ADD COLUMN game_marks jsonb;
ALTER TABLE matches ADD CONSTRAINT matches_game_marks_check
  CHECK (game_marks IS NULL OR (jsonb_typeof(game_marks) = 'object' AND octet_length(game_marks::text) <= 32768));
COMMENT ON COLUMN matches.game_marks IS 'Timeouts and period bounds from the league feed; see packages/shared/lib/game-marks.ts';
