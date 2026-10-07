import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  getMyTeamChoices,
  getSpaceTeamSuggestions,
  listLeagueTeams,
  setMyTeam,
} from "@scoutable/shared/lib/league-teams-db";
import { currentTeams } from "@scoutable/shared/lib/league-teams";
import type { LeagueTeam, TeamChoice } from "@scoutable/shared/types/league-team";

/**
 * "Your team": the user's answer per space (space_team_choices). Loaded once
 * per signed-in user. `loaded` stays false when the read fails, so the team
 * step never nags someone whose answers we simply couldn't read.
 */
interface MyTeamValue {
  choices: TeamChoice[];
  loaded: boolean;
  save: (orgIds: string[], answer: { teamId?: string | null; unlistedTeam?: string | null }) => Promise<void>;
}

const MyTeamContext = createContext<MyTeamValue>({
  choices: [],
  loaded: false,
  save: async () => {},
});

const NO_CHOICES: TeamChoice[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

export function MyTeamProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Tagged with the user they belong to, so a sign-out or account switch
  // reads as "not loaded" without resetting state inside the effect.
  const [state, setState] = useState<{ forUser: string; choices: TeamChoice[] } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getMyTeamChoices(createClient())
      .then((choices) => {
        if (!cancelled) setState({ forUser: userId, choices });
      })
      .catch((e) => console.error("[my-team] load failed:", e));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loaded = userId !== null && state?.forUser === userId;
  const choices = loaded ? state.choices : NO_CHOICES;

  const save = useCallback<MyTeamValue["save"]>(
    async (orgIds, answer) => {
      if (!userId) return;
      const supabase = createClient();
      await setMyTeam(supabase, orgIds, answer);
      setState({ forUser: userId, choices: await getMyTeamChoices(supabase) });
    },
    [userId],
  );

  const value = useMemo(() => ({ choices, loaded, save }), [choices, loaded, save]);
  return <MyTeamContext.Provider value={value}>{children}</MyTeamContext.Provider>;
}

export const useMyTeam = () => useContext(MyTeamContext);

// The catalogue is the same for everyone and changes weekly at most: one read per app session.
let catalogPromise: Promise<LeagueTeam[]> | null = null;

/** Teams in the current season of every supported league, for the picker. */
export function useTeamCatalog(): { teams: LeagueTeam[] | null; failed: boolean; retry: () => void } {
  const [teams, setTeams] = useState<LeagueTeam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    catalogPromise ??= listLeagueTeams(createClient()).then(currentTeams);
    catalogPromise
      .then((t) => {
        if (!cancelled) setTeams(t);
      })
      .catch((e) => {
        console.error("[my-team] catalogue load failed:", e);
        catalogPromise = null;
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setFailed(false);
    setAttempt((a) => a + 1);
  };
  return { teams, failed, retry };
}

/** Ids of the club's teams to list first in a club space; empty for personal spaces. */
export function useSpaceSuggestions(orgId: string | null, isPersonal: boolean): ReadonlySet<string> {
  const [state, setState] = useState<{ forOrg: string; ids: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!orgId || isPersonal) return;
    let cancelled = false;
    getSpaceTeamSuggestions(createClient(), orgId)
      .then((t) => {
        if (!cancelled) setState({ forOrg: orgId, ids: new Set(t.map((x) => x.id)) });
      })
      .catch((e) => console.error("[my-team] suggestions failed:", e));
    return () => {
      cancelled = true;
    };
  }, [orgId, isPersonal]);
  return !isPersonal && state && state.forOrg === orgId ? state.ids : NO_IDS;
}
