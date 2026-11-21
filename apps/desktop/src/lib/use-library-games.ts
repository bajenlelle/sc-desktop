import { useEffect, useState } from "react";
import { listMatchesLight } from "@scoutable/shared/lib/matches-db";
import { statsKindOf } from "@scoutable/shared/lib/stats-card-data";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";

export interface LibraryGames {
  /** The coach's own Genius games in the space, archived ones included: Genius match id → the game's id. */
  games: ReadonlyMap<number, string>;
  /** The league of the newest of them, for the Teams page's first league. */
  newestLeagueId: string | null;
  ready: boolean;
}

const EMPTY: LibraryGames = { games: new Map(), newestLeagueId: null, ready: false };

/**
 * Which league games the coach has. Only their own: a coach can't read a
 * colleague's games, so "in your library" is per coach, as the Library is.
 */
export function useLibraryGames(): LibraryGames {
  const { activeOrgId } = useAuth();
  const [state, setState] = useState<{ org: string | null; value: LibraryGames }>({ org: null, value: EMPTY });

  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    listMatchesLight(createClient(), activeOrgId, { ownOnly: true })
      .then((matches) => {
        if (cancelled) return;
        const games = new Map<number, string>();
        let newestLeagueId: string | null = null;
        // Newest import first, as listMatchesLight orders them.
        for (const m of matches) {
          if (statsKindOf(m) !== "genius") continue;
          games.set(Number(m.sourceGameId), m.id);
          newestLeagueId ??= m.leagueId ?? null;
        }
        setState({ org: activeOrgId, value: { games, newestLeagueId, ready: true } });
      })
      .catch((e) => {
        console.error("[teams] library read failed:", e);
        if (!cancelled) setState({ org: activeOrgId, value: { ...EMPTY, ready: true } });
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  return state.org === activeOrgId ? state.value : EMPTY;
}
