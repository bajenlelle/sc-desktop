import { useEffect, useState } from "react";
import type { League } from "@scoutable/shared/types/league";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { loadGameStats, loadSeasonPlayers, seasonOf } from "@/lib/stats-card-data";
import type { HostedSeasonPlayer } from "@scoutable/shared/lib/hosted-stats";

import type { LeaguePerson, MinutesSource } from "@scoutable/shared/lib/game-players";

export type { MinutesSource };
type BoxScorePerson = LeaguePerson;

/**
 * Minutes and plus-minus from the league's box score, by personId (the plays
 * have neither). Players the box score lists who have no play of their own
 * are returned too, so the table can add them. Without the box score (offline,
 * a changed page, a league with no hosted stats), the table counts minutes
 * and plus-minus from the fives on the plays (`stints`), else shows none.
 */
export function useGameBoxScore(
  match: StoredMatch,
  leagues: League[],
  hasFives: boolean,
): { byPerson: ReadonlyMap<number, BoxScorePerson>; status: MinutesSource } {
  const [state, setState] = useState<{ byPerson: ReadonlyMap<number, BoxScorePerson>; status: MinutesSource }>({
    byPerson: new Map(),
    status: "reading",
  });
  const competitionId = seasonOf(match, leagues)?.competitionId ?? null;
  useEffect(() => {
    let cancelled = false;
    const fallback: MinutesSource = hasFives ? "stints" : "none";
    void loadGameStats(match, leagues)
      .then((stats) => {
        if (cancelled) return;
        if (!stats || stats.source !== "genius_hosted") {
          setState({ byPerson: new Map(), status: fallback });
          return;
        }
        const byPerson = new Map<number, BoxScorePerson>();
        for (const p of stats.players) {
          const id = Number(p.player.id);
          if (!Number.isFinite(id)) continue;
          byPerson.set(id, { min: p.line.min, pm: p.line.pm, number: p.player.number, name: p.player.name, side: p.side === "home" ? 1 : 2 });
        }
        setState({ byPerson, status: "box" });
      })
      .catch(() => {
        if (!cancelled) setState({ byPerson: new Map(), status: fallback });
      });
    return () => {
      cancelled = true;
    };
    // The game and its season are what the read depends on; a refreshed leagues list with the same season reads nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, competitionId, hasFives]);
  return state;
}

/** The league's season averages for every player in the game's competition; null while reading or without a season. */
export function useSeasonPlayers(
  match: StoredMatch,
  leagues: League[],
): { players: ReadonlyMap<string, HostedSeasonPlayer> | null; status: "none" | "reading" | "ready" | "failed"; retry: () => void } {
  const competitionId = seasonOf(match, leagues)?.competitionId ?? null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ players: ReadonlyMap<string, HostedSeasonPlayer> | null; status: "none" | "reading" | "ready" | "failed" }>({
    players: null,
    status: competitionId ? "reading" : "none",
  });
  useEffect(() => {
    if (!competitionId) {
      setState({ players: null, status: "none" });
      return;
    }
    let cancelled = false;
    setState((s) => ({ players: s.players, status: "reading" }));
    void loadSeasonPlayers(competitionId, { fresh: attempt > 0 })
      .then((players) => !cancelled && setState({ players, status: "ready" }))
      .catch(() => !cancelled && setState({ players: null, status: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [competitionId, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
