import { useEffect, useState } from "react";
import type { League } from "@scoutable/shared/types/league";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { getGeniusSeason } from "@scoutable/shared/lib/genius-client";
import { seasonContext, seasonMatchOf, type SeasonContext } from "@scoutable/shared/lib/season-context";
import type { SeasonPayload } from "@scoutable/shared/lib/season-payload";
import { createClient } from "@/lib/supabase/client";

export type SeasonStatus = "none" | "reading" | "ready" | "failed";

const TTL_MS = 30 * 60 * 1000;
/** One request per competition per half hour; the function caches 12 hours behind it. A failure is asked again next time. */
const cache = new Map<number, { at: number; payload: Promise<SeasonPayload | null> }>();

/** The competition's season; null from a genius function that predates the action (the view goes on without it). */
function loadSeason(competitionId: number): Promise<SeasonPayload | null> {
  const hit = cache.get(competitionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.payload;
  const payload = (async () => {
    const res = await getGeniusSeason(createClient(), competitionId);
    if (!res.ok && res.error === "unknown_action") return null;
    if (!res.ok) throw new Error(`season: ${res.error}`);
    return res.data;
  })();
  cache.set(competitionId, { at: Date.now(), payload });
  payload.catch(() => cache.delete(competitionId));
  return payload;
}

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
