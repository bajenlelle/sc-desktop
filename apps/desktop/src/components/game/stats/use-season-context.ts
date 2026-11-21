import { useEffect, useState } from "react";
import type { League } from "@scoutable/shared/types/league";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { seasonContext, seasonMatchOf, type SeasonContext } from "@scoutable/shared/lib/season-context";
import { loadSeason } from "@/lib/league-data";

export type SeasonStatus = "none" | "reading" | "ready" | "failed";

/**
 * Each team's season beside this game, for the Stats view's season context
 * (docs/game-view.md, "Stats"). "none" for a game that isn't a Genius game,
 * that its season doesn't list, or whose genius function predates the season
 * action; the view then stays as it is without it.
 */
export function useSeasonContext(match: StoredMatch, leagues: League[]): { status: SeasonStatus; context: SeasonContext | null } {
  const target = seasonMatchOf(match, leagues);
  const competitionId = target?.competitionId ?? null;
  const matchId = target?.matchId ?? null;
  const [state, setState] = useState<{ status: SeasonStatus; context: SeasonContext | null }>({
    status: competitionId ? "reading" : "none",
    context: null,
  });
  useEffect(() => {
    if (competitionId === null || matchId === null) {
      setState({ status: "none", context: null });
      return;
    }
    let cancelled = false;
    setState({ status: "reading", context: null });
    void loadSeason(competitionId)
      .then((payload) => {
        if (cancelled) return;
        const context = payload ? seasonContext(payload, matchId) : null;
        setState(context ? { status: "ready", context } : { status: "none", context: null });
      })
      .catch(() => !cancelled && setState({ status: "failed", context: null }));
    return () => {
      cancelled = true;
    };
  }, [competitionId, matchId]);
  return state;
}
