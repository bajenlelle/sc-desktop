/**
 * The Highlights page's state: who the player is, the games they played in, the suggested plays, the ones in the
 * video and their order, and each one's framing (Claude, through lib/highlight-framing.ts). Framing starts for the
 * plays in the video as soon as they are there, and for a play when it's added; a play's framing is kept for the
 * session when it's taken out and put back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CropKeyframe } from "@scoutable/shared/lib/crop-path";
import type { FramedClip } from "@scoutable/shared/lib/highlight-frame-client";
import { bestGameId, candidateWindow, myGames, playersInGames, type GamePlayer, type MyGame } from "@scoutable/shared/lib/highlight-games";
import { highlightOrder, pickHighlights, type HighlightCandidate } from "@scoutable/shared/lib/highlight-picks";
import { getMyPlayer, setMyPlayer, type MyPlayer } from "@scoutable/shared/lib/my-player-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { frameHighlightClips, type FrameJob } from "@/lib/highlight-framing";
import { listEventsForMatches, listMatchesLight } from "@/lib/matches-db";
import { Sentry } from "@/lib/sentry";
import { createClient } from "@/lib/supabase/client";
import { probeMatches } from "@/lib/video-probe";

export type Framing =
  | { state: "framing" }
  | { state: "ready"; clip: FramedClip; edited: boolean }
  | { state: "failed"; error: string };

export interface HighlightPlay {
  candidate: HighlightCandidate;
  match: StoredMatch;
  window: { start: number; end: number } | null;
}

export function useHighlights() {
  const { activeOrgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState<StoredMatch[]>([]);
  const [missingVideo, setMissingVideo] = useState<Set<string>>(new Set());
  const [player, setPlayer] = useState<MyPlayer | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [framing, setFraming] = useState<Map<string, Framing>>(new Map());
  const inflight = useRef(new Set<string>());
  const abort = useRef<AbortController | null>(null);

  // The space's own games with their plays, and who the account is.
  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [list, me] = await Promise.all([listMatchesLight(activeOrgId, { ownOnly: true }), getMyPlayer(createClient())]);
        const active = list.filter((m) => !m.archivedAt && !m.isDemo);
        const events = await listEventsForMatches(active.map((m) => m.id));
        const withEvents = active.map((m) => ({ ...m, events: events[m.id] ?? [] }));
        const status = await probeMatches(withEvents);
        if (cancelled) return;
        setGames(withEvents);
        setMissingVideo(new Set([...status].filter(([, s]) => s !== "ok").map(([id]) => id)));
        setPlayer(me);
        trackEvent("highlight_page_opened", { has_player: !!me, games: withEvents.length });
      } catch (err) {
        Sentry.captureException(err, { tags: { feature: "highlights", step: "load" } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  const players: GamePlayer[] = useMemo(() => playersInGames(games), [games]);
  const mine: MyGame[] = useMemo(() => (player ? myGames(games, player.personId) : []), [games, player]);
  const matchById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  // The best game is picked when the player's games are known.
  useEffect(() => {
    const best = bestGameId(mine.filter((g) => !missingVideo.has(g.id)));
    setSelected(best ? new Set([best]) : new Set());
  }, [mine, missingVideo]);

  // Every suggested play of the picked games, oldest game first, in game order.
  const plays: HighlightPlay[] = useMemo(() => {
    const picked = mine.filter((g) => selected.has(g.id)).sort((a, b) => (a.date < b.date ? -1 : 1));
    return picked.flatMap((g) => {
      const match = matchById.get(g.id)!;
      return g.candidates.map((candidate) => ({ candidate, match, window: candidateWindow(candidate, match.syncPoint) }));
    });
  }, [mine, selected, matchById]);
  const playByKey = useMemo(() => new Map(plays.map((p) => [p.candidate.key, p])), [plays]);

  // A new set of games starts from the default picks in the video's order.
  useEffect(() => {
    const usable = plays.filter((p) => p.window).map((p) => p.candidate);
    const keys = pickHighlights(usable);
    const ordered = highlightOrder(usable.filter((c) => keys.has(c.key))).map((c) => c.key);
    setOrder(ordered);
    if (plays.length) trackEvent("highlight_suggestions_shown", { games: selected.size, candidates: usable.length, picked: ordered.length });
  }, [plays]);

  // Frame what's in the video and hasn't been framed yet.
  useEffect(() => {
    const todo = order.filter((k) => !framing.has(k) && !inflight.current.has(k));
    const jobs: FrameJob[] = todo.flatMap((k) => {
      const p = playByKey.get(k);
      if (!p?.window || !p.match.videoUrl) return [];
      return [{ candidate: p.candidate, videoPath: p.match.videoUrl, window: p.window, teams: { home: p.match.homeTeam.name, away: p.match.awayTeam.name } }];
    });
    if (jobs.length === 0) return;
    for (const j of jobs) inflight.current.add(j.candidate.key);
    setFraming((m) => new Map([...m, ...jobs.map((j) => [j.candidate.key, { state: "framing" } as Framing] as const)]));
    abort.current ??= new AbortController();
    void frameHighlightClips(jobs, {
      signal: abort.current.signal,
      onClip: (o) => {
        inflight.current.delete(o.key);
        setFraming((m) => new Map(m).set(o.key, o.ok ? { state: "ready", clip: o.clip, edited: false } : { state: "failed", error: o.error }));
      },
    }).then((outcomes) => {
      for (const o of outcomes) inflight.current.delete(o.key);
      // Jobs that never started (switched off, the daily limit, or left the page) are marked so the tile says why.
      setFraming((m) => {
        const next = new Map(m);
        for (const o of outcomes) if (!o.ok && next.get(o.key)?.state === "framing") next.set(o.key, { state: "failed", error: o.error });
        return next;
      });
    });
  }, [order, playByKey, framing]);

  useEffect(() => () => abort.current?.abort(), []);

  const choosePlayer = useCallback(async (p: GamePlayer) => {
    const next: MyPlayer = { personId: p.personId, name: p.name, number: p.number };
    const changed = !!player && player.personId !== p.personId;
    await setMyPlayer(createClient(), next);
    setPlayer(next);
    trackEvent("highlight_player_set", { changed });
  }, [player]);

  const toggleGame = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const add = useCallback((key: string) => {
    setOrder((o) => (o.includes(key) ? o : [...o, key]));
    trackEvent("highlight_clip_toggled", { on: true, kind: playByKey.get(key)?.candidate.kind });
  }, [playByKey]);

  const remove = useCallback((key: string) => {
    setOrder((o) => o.filter((k) => k !== key));
    trackEvent("highlight_clip_toggled", { on: false, kind: playByKey.get(key)?.candidate.kind });
  }, [playByKey]);

  const retry = useCallback((key: string) => {
    setFraming((m) => {
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  }, []);

  const setKeyframes = useCallback((key: string, keyframes: CropKeyframe[]) => {
    setFraming((m) => {
      const f = m.get(key);
      if (f?.state !== "ready") return m;
      return new Map(m).set(key, { state: "ready", clip: { ...f.clip, keyframes }, edited: true });
    });
  }, []);

  return {
    loading,
    games,
    missingVideo,
    player,
    players,
    mine,
    selected,
    plays,
    playByKey,
    order,
    framing,
    choosePlayer,
    toggleGame,
    add,
    remove,
    reorder: setOrder,
    retry,
    setKeyframes,
  };
}
