import { useMemo } from "react";
import { resolveGameMarks } from "@scoutable/shared/lib/game-marks";
import { GAME_MOMENTS, type GameMoment } from "@scoutable/shared/lib/game-flow";
import { momentsOfGame } from "@scoutable/shared/lib/play-filters";
import type { GameMarks } from "@scoutable/shared/types/game-marks";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";

/** One game the list holds: its id, its plays and its marks when the library has them. */
export interface MomentGame {
  gameId: string;
  events: readonly PlayByPlayEvent[];
  gameMarks?: GameMarks | null;
}

/**
 * The moments of a list's plays across its games (After timeouts, Quarter starts…), for the When section and
 * its filter outside the game view: each game's from its plays and its marks (`resolveGameMarks`: stored, else
 * what its plays carry). After timeouts is off with a reason while no game has a timeout on record.
 */
export function usePlayMoments(games: readonly MomentGame[]) {
  return useMemo(() => {
    const byGame = new Map<string, Map<number, ReadonlySet<GameMoment>>>();
    const counts = Object.fromEntries(GAME_MOMENTS.map((m) => [m, 0])) as Record<GameMoment, number>;
    let timeouts = false;
    for (const g of games) {
      const marks = resolveGameMarks({ gameMarks: g.gameMarks, events: g.events });
      if (marks && marks.timeouts.length > 0) timeouts = true;
      const moments = momentsOfGame(g.events, marks);
      byGame.set(g.gameId, moments);
      for (const set of moments.values()) for (const m of set) counts[m]++;
    }
    const why: Partial<Record<GameMoment, string>> = {};
    if (!timeouts) why.after_timeout = games.length === 1 ? "This game has no timeouts on record." : "These games have no timeouts on record.";
    const momentsOf = (gameId: string, eventId: number) => byGame.get(gameId)?.get(eventId);
    return { counts, why, momentsOf };
  }, [games]);
}
