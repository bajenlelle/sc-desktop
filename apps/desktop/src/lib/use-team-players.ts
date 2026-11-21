import { useCallback, useEffect, useState } from "react";
import { listTeamRoster } from "@scoutable/shared/lib/league-players-db";
import { teamPlayers, type TeamPlayerRow } from "@scoutable/shared/lib/team-players";
import { loadSeasonPlayers } from "@/lib/stats-card-data";
import { createClient } from "@/lib/supabase/client";

/** "no_roster": the roster sync hasn't reached this team. "past_season": rosters exist for current seasons only. */
export type TeamPlayersStatus = "reading" | "ready" | "failed" | "no_roster" | "past_season";

/** A team's players with their season lines: its roster joined to the league's season page. */
export function useTeamPlayers(
  competitionId: number | null,
  teamId: number,
  current: boolean,
): { status: TeamPlayersStatus; rows: TeamPlayerRow[]; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const key = `${competitionId}/${teamId}/${current}/${attempt}`;
  const [state, setState] = useState<{ key: string; status: TeamPlayersStatus; rows: TeamPlayerRow[] } | null>(null);

  useEffect(() => {
    if (competitionId === null || !current) return;
    let cancelled = false;
    (async () => {
      const roster = await listTeamRoster(createClient(), String(teamId));
      if (roster.length === 0) return { status: "no_roster" as const, rows: [] };
      const season = await loadSeasonPlayers(competitionId, { fresh: attempt > 0 });
      return { status: "ready" as const, rows: teamPlayers(roster, season) };
    })()
      .then((r) => !cancelled && setState({ key, ...r }))
      .catch((e) => {
        console.error("[teams] players read failed:", e);
        if (!cancelled) setState({ key, status: "failed", rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [key, competitionId, teamId, current, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  if (!current) return { status: "past_season", rows: [], retry };
  if (state?.key !== key) return { status: "reading", rows: [], retry };
  return { status: state.status, rows: state.rows, retry };
}
