import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playability, type GamePlays, type TeamGame } from "@scoutable/shared/lib/team-video";
import type { StoredMatch } from "@/types/match";
import { listEventsForMatchesChecked, listMatchesByIds } from "@/lib/matches-db";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";

/** Games whose plays are read in one go: a few at a time, so the newest show first and a long season never waits on one big read. */
const BATCH = 4;

export interface TeamPlays {
  /** none: the coach has none of the team's games; reading: some are still out; ready: every game landed or failed. */
  status: "none" | "reading" | "ready";
  /** The games read so far with their plays, newest first. */
  games: readonly GamePlays[];
  /** The library games by id: title, video and sync. */
  matches: ReadonlyMap<string, StoredMatch>;
  /** Whether a game's plays can play here. */
  playable: (gameId: string) => "ok" | "video" | "sync";
  /** Games whose plays couldn't be read. */
  failed: readonly TeamGame[];
  /** Reads the failed games again. */
  retry: () => void;
}

/**
 * A team's games in the coach's library and their plays (docs/teams.md,
 * "Plays"), read once per team: the games' rows, then their plays four at a
 * time, newest first, each landing as it comes. A read for a team the page
 * has moved on from never lands. The plays come through the shared cache
 * (`listEventsForMatchesChecked`), so a game the coach opens next is already read.
 */
export function useTeamPlays(teamGames: readonly TeamGame[], key: string, libraryReady = true): TeamPlays {
  const [state, setState] = useState<{
    key: string;
    games: GamePlays[];
    matches: Map<string, StoredMatch>;
    video: Map<string, VideoFileStatus>;
    failed: string[];
    done: Set<string>;
  }>({ key: "", games: [], matches: new Map(), video: new Map(), failed: [], done: new Set() });
  const keyNow = useRef(key);
  keyNow.current = key;
  const [attempt, setAttempt] = useState(0);
  /** Set by `retry`: the next read is of the failed games only (never on mount, so React's second dev run reads everything again). */
  const retrying = useRef(false);
  // The games' ids as one string: the page's array changes identity on every render.
  const ids = teamGames.map((g) => g.gameId).join(",");
  const byId = useMemo(() => new Map(teamGames.map((g) => [g.gameId, g])), [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    const live = () => !cancelled && keyNow.current === key;
    const fresh = !retrying.current || state.key !== key;
    retrying.current = false;
    // A retry reads every game that hasn't landed: the failed ones, and any a read cut short by the retry never reached.
    const landed = new Set(state.games.map((g) => g.game.gameId));
    const toRead = fresh ? [...byId.keys()] : [...byId.keys()].filter((id) => !landed.has(id));
    if (fresh) setState({ key, games: [], matches: new Map(), video: new Map(), failed: [], done: new Set() });
    else setState((s) => ({ ...s, failed: [], done: new Set([...s.done].filter((id) => !toRead.includes(id))) }));

    void (async () => {
      let matches: StoredMatch[] = [];
      try {
        matches = await listMatchesByIds(toRead);
      } catch {
        if (live()) setState((s) => ({ ...s, failed: toRead, done: new Set([...s.done, ...toRead]) }));
        return;
      }
      if (!live()) return;
      setState((s) => ({ ...s, matches: new Map([...s.matches, ...matches.map((m) => [m.id, m] as const)]) }));
      void probeMatches(matches).then((video) => {
        if (live()) setState((s) => ({ ...s, video: new Map([...s.video, ...video]) }));
      });
      for (let i = 0; i < toRead.length; i += BATCH) {
        const batch = toRead.slice(i, i + BATCH);
        let result: { byMatch: Record<string, GamePlays["events"]>; failed: string[] };
        try {
          result = await listEventsForMatchesChecked(batch);
        } catch {
          result = { byMatch: {}, failed: batch };
        }
        if (!live()) return;
        const landed: GamePlays[] = [];
        for (const id of batch) {
          const game = byId.get(id);
          if (game && !result.failed.includes(id)) landed.push({ game, events: result.byMatch[id] ?? [] });
        }
        setState((s) => ({
          ...s,
          games: [...s.games.filter((g) => !batch.includes(g.game.gameId)), ...landed].sort((a, b) => b.game.at.localeCompare(a.game.at)),
          failed: [...s.failed, ...result.failed],
          done: new Set([...s.done, ...batch]),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // A retry reads only the failed games; `state` is read at that moment on purpose.
  }, [key, ids, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    retrying.current = true;
    setAttempt((n) => n + 1);
  }, []);
  const current = state.key === key;
  const matches = current ? state.matches : EMPTY_MATCHES;
  const video = current ? state.video : EMPTY_VIDEO;
  const playable = useCallback(
    (gameId: string) => {
      const m = matches.get(gameId);
      return m ? playability(m, video.get(gameId)) : "video";
    },
    [matches, video],
  );

  // Until the library is read, no games is not yet "none of their games".
  if (!ids) return { status: libraryReady ? "none" : "reading", games: [], matches: EMPTY_MATCHES, playable, failed: [], retry };
  const done = current ? state.done : new Set<string>();
  return {
    status: [...byId.keys()].every((id) => done.has(id)) ? "ready" : "reading",
    games: current ? state.games : [],
    matches,
    playable,
    failed: current ? state.failed.flatMap((id) => byId.get(id) ?? []) : [],
    retry,
  };
}

const EMPTY_MATCHES: ReadonlyMap<string, StoredMatch> = new Map();
const EMPTY_VIDEO: ReadonlyMap<string, VideoFileStatus> = new Map();
