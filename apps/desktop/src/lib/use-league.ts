import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeniusFixture } from "@scoutable/shared/lib/genius";
import { leagueSeason, type LeagueSeason } from "@scoutable/shared/lib/league-season";
import type { SeasonPayload } from "@scoutable/shared/lib/season-payload";
import { forgetLeague, loadFixtures, loadSeason } from "@/lib/league-data";

/**
 * "none": no competition asked for. "unavailable": the competition has no team
 * statistics, or the genius function predates the season action.
 */
export type LeagueStatus = "none" | "reading" | "ready" | "unavailable" | "failed";

export interface LeagueState {
  status: LeagueStatus;
  payload: SeasonPayload | null;
  fixtures: GeniusFixture[];
  league: LeagueSeason | null;
  retry: () => void;
}

/** A competition's season and fixtures, and the league-wide reading of them (league-season.ts). */
export function useLeague(competitionId: number | null): LeagueState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ for: number | null; status: LeagueStatus; payload: SeasonPayload | null; fixtures: GeniusFixture[] }>({
    for: null,
    status: "none",
    payload: null,
    fixtures: [],
  });

  useEffect(() => {
    if (competitionId === null) return;
    let cancelled = false;
    setState({ for: competitionId, status: "reading", payload: null, fixtures: [] });
    Promise.all([loadSeason(competitionId), loadFixtures(competitionId)])
      .then(([payload, fixtures]) => {
        if (cancelled) return;
        const empty = !payload || (payload.games.length === 0 && payload.standings.length === 0);
        setState({ for: competitionId, status: empty ? "unavailable" : "ready", payload, fixtures });
      })
      .catch(() => {
        if (!cancelled) setState({ for: competitionId, status: "failed", payload: null, fixtures: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, attempt]);

  const retry = useCallback(() => {
    if (competitionId !== null) forgetLeague(competitionId);
    setAttempt((a) => a + 1);
  }, [competitionId]);

  const current = competitionId !== null && state.for === competitionId;
  const payload = current ? state.payload : null;
  const league = useMemo(() => (payload ? leagueSeason(payload) : null), [payload]);
  if (competitionId === null) return { status: "none", payload: null, fixtures: [], league: null, retry };
  if (!current) return { status: "reading", payload: null, fixtures: [], league: null, retry };
  return { status: state.status, payload, fixtures: state.fixtures, league: state.status === "ready" ? league : null, retry };
}
