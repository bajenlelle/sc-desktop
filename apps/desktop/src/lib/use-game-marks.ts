import { useEffect, useState } from "react";
import { gameMarksStale, resolveGameMarks } from "@scoutable/shared/lib/game-marks";
import { geniusGameId } from "@scoutable/shared/lib/game-marks-fill";
import type { GameMarks } from "@scoutable/shared/types/game-marks";
import { trackEvent } from "@/lib/analytics";
import { fillGameMarks } from "@/lib/matches-db";
import { seasonOf } from "@/lib/stats-card-data";
import { useLeagues } from "@/lib/use-leagues";
import type { StoredMatch } from "@/types/match";

/**
 * Marks read on this run of the app, by game: a game whose marks couldn't be
 * stored (not the owner's, or a database the migration hasn't reached) isn't
 * read again every time its view opens.
 */
const readThisSession = new Map<string, GameMarks>();
/** Reads that failed, by game. One more try per run of the app, then the game goes without. */
const failures = new Map<string, number>();
const MAX_FAILURES = 2;

/**
 * A game's timeouts and period bounds for the game view. Stored marks are
 * used as they are; a game that has none (or was imported again since) is
 * read from the league feed once, when its view opens, and never as a sweep
 * (lib/game-marks-fill.ts says why). `reading` is true while that read is
 * out; a game the feed can't answer for simply has no timeouts.
 */
export function useGameMarks(match: StoredMatch): { marks: GameMarks | null; reading: boolean } {
  const leagues = useLeagues();
  const competitionId = seasonOf(match, leagues)?.competitionId ?? null;
  const [read, setRead] = useState<{ matchId: string; marks: GameMarks } | null>(null);
  const [reading, setReading] = useState(false);

  const stale = gameMarksStale(match.gameMarks, match.events);
  const canRead = geniusGameId(match) !== null && competitionId !== null;

  useEffect(() => {
    if (!stale || !canRead || readThisSession.has(match.id) || (failures.get(match.id) ?? 0) >= MAX_FAILURES) return;
    let cancelled = false;
    setReading(true);
    void fillGameMarks(match, competitionId).then((fill) => {
      if (fill.outcome === "failed") failures.set(match.id, (failures.get(match.id) ?? 0) + 1);
      else if (fill.marks) readThisSession.set(match.id, fill.marks);
      if (fill.outcome !== "fresh") {
        trackEvent("game_marks_filled", {
          outcome: fill.outcome,
          timeouts: fill.marks?.timeouts.length ?? 0,
          ...(fill.error ? { error: fill.error } : {}),
        });
      }
      if (cancelled) return;
      setReading(false);
      if (fill.marks && fill.outcome !== "failed") setRead({ matchId: match.id, marks: fill.marks });
    });
    return () => {
      cancelled = true;
    };
    // The read is keyed by the game and its plays, not by the match object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, stale, canRead, competitionId]);

  const fresh = read?.matchId === match.id ? read.marks : (readThisSession.get(match.id) ?? null);
  const marks = stale ? (fresh ?? resolveGameMarks(match)) : resolveGameMarks(match);
  return { marks, reading: reading && !fresh };
}
