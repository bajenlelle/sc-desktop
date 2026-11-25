import { useMemo } from "react";
import type { League } from "@scoutable/shared/types/league";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { seasonMatchOf } from "@scoutable/shared/lib/season-context";
import { useSeasonContext } from "./stats/use-season-context";
import type { GameTeams } from "./stats/side-team-link";

/**
 * Where a game's two teams' pages are (docs/navigation.md): the game's competition and each team's id in its
 * season, once the season is read (cached, lib/league-data.ts). Neither for a game no season lists.
 */
export function useGameTeams(match: StoredMatch | null, leagues: League[]): GameTeams & { season: ReturnType<typeof useSeasonContext> } {
  const season = useSeasonContext(match ?? NO_MATCH, leagues);
  const competitionId = match ? (seasonMatchOf(match, leagues)?.competitionId ?? null) : null;
  const ctx = season.context;
  return useMemo(
    () => ({
      season,
      home: competitionId && ctx ? { competitionId, teamId: ctx.home.teamId } : null,
      away: competitionId && ctx ? { competitionId, teamId: ctx.away.teamId } : null,
    }),
    [season, competitionId, ctx],
  );
}

/** Stands in while the game is still being read: no season. */
const NO_MATCH = { events: [], sourceGameId: null } as unknown as StoredMatch;
