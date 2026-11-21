import { useEffect, useMemo, useState } from "react";
import { getTeamSources } from "@scoutable/shared/lib/league-teams-db";
import { teamSeasons, type TeamSource } from "@scoutable/shared/lib/team-games";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";
import type { League } from "@scoutable/shared/types/league";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { createClient } from "@/lib/supabase/client";

const NONE: ReadonlySet<number> = new Set();

/** The space's "Your team", or null when it has none. */
export function useSpaceTeam(): LeagueTeam | null {
  const { activeOrgId } = useAuth();
  const { choices } = useMyTeam();
  return choices.find((c) => c.orgId === activeOrgId)?.team ?? null;
}

/** The space's team's ids in this competition (a Genius team id is per season); empty when it has no team here. */
export function useMyTeamIds(competitionId: number | null, leagues: League[]): ReadonlySet<number> {
  const team = useSpaceTeam();
  const teamId = team?.id ?? null;
  const [sources, setSources] = useState<{ for: string; list: TeamSource[] } | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    getTeamSources(createClient(), teamId)
      .then((list) => !cancelled && setSources({ for: teamId, list }))
      .catch((e) => console.error("[teams] team sources read failed:", e));
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return useMemo(() => {
    if (!teamId || competitionId === null || sources?.for !== teamId) return NONE;
    const season = teamSeasons(sources.list, leagues).find((s) => s.season.competitionId === competitionId);
    return season ? new Set([...season.teamIds].map(Number)) : NONE;
  }, [teamId, competitionId, sources, leagues]);
}
