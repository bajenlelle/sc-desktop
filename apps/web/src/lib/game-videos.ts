"use client";

/**
 * Cloud game videos on the web: the viewer's own copies (RLS shows nobody
 * else's) and the presigned play URLs the `game-video` function mints for
 * them. URLs live 12 hours and are shared by every component on the page
 * through a module cache, so a game is signed once per visit; a URL inside
 * its last ten minutes is treated as gone and fetched again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playGameVideo } from "@scoutable/shared/lib/game-video-client";
import { isSignedUrlFresh, type GameVideoPlayResponse } from "@scoutable/shared/lib/game-video-wire";
import { listMyGameVideos, type GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { createClient } from "@/lib/supabase/client";

const urlCache = new Map<string, GameVideoPlayResponse>();
const inflight = new Map<string, Promise<GameVideoPlayResponse | null>>();

/** The game's play URL, from the cache while fresh, else newly signed. Null when the viewer has no copy. */
export function fetchPlayUrl(matchId: string, opts: { force?: boolean } = {}): Promise<GameVideoPlayResponse | null> {
  const cached = urlCache.get(matchId);
  if (!opts.force && cached && isSignedUrlFresh(cached.expiresAt)) return Promise.resolve(cached);
  let pending = inflight.get(matchId);
  if (!pending) {
    pending = (async () => {
      const result = await playGameVideo(createClient(), matchId);
      if (!result.ok) {
        urlCache.delete(matchId);
        return null;
      }
      urlCache.set(matchId, result.data);
      return result.data;
    })().finally(() => inflight.delete(matchId));
    inflight.set(matchId, pending);
  }
  return pending;
}

/** The cached play URL, if it is still fresh; never fetches. */
export function cachedPlayUrl(matchId: string): string | null {
  const cached = urlCache.get(matchId);
  return cached && isSignedUrlFresh(cached.expiresAt) ? cached.url : null;
}

/**
 * Prefetches play URLs for games as soon as the page knows them, so a tap
 * can set the source and play in one go (iPhone plays with sound only from a
 * gesture). `urlFor` answers from the cache; `version` changes as URLs land.
 */
export function usePlayUrls(matchIds: readonly string[]): {
  urlFor: (matchId: string) => string | null;
  refresh: (matchId: string) => Promise<string | null>;
  version: number;
} {
  const [version, setVersion] = useState(0);
  const key = [...matchIds].sort().join("\u0000");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split("\u0000");
    for (const id of ids) {
      if (cachedPlayUrl(id)) continue;
      void fetchPlayUrl(id).then((r) => {
        if (!cancelled && r) setVersion((v) => v + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  const refresh = useCallback(async (matchId: string) => {
    const r = await fetchPlayUrl(matchId, { force: true });
    setVersion((v) => v + 1);
    return r?.url ?? null;
  }, []);
  // version is read so a new URL re-renders whoever calls urlFor.
  const urlFor = useCallback((matchId: string) => cachedPlayUrl(matchId), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  return { urlFor, refresh, version };
}

/** A short-lived memo of "my ready copies", shared by the sidebar, the tab bar and the pages. */
let readyCache: { at: number; promise: Promise<GameVideo[]> } | null = null;
const READY_TTL_MS = 60_000;
const listeners = new Set<() => void>();

function loadReady(force = false): Promise<GameVideo[]> {
  if (!force && readyCache && Date.now() - readyCache.at < READY_TTL_MS) return readyCache.promise;
  const promise = listMyGameVideos(createClient(), { status: "ready" });
  readyCache = { at: Date.now(), promise };
  return promise;
}

/** The viewer's ready copies, from the same short-lived memo the hook below uses. */
export function fetchMyCloudGames(): Promise<GameVideo[]> {
  return loadReady();
}

/** Forgets the cached list (after a change elsewhere) and tells every subscriber to reload. */
export function invalidateCloudGames() {
  readyCache = null;
  for (const l of listeners) l();
}

/**
 * The viewer's games with a ready cloud copy. Null while loading. Scoped to
 * a space when `orgId` is given (a copy carries the game's space); the
 * player-only navigation passes none and sees them all.
 */
export function useMyCloudGames(opts: { orgId?: string | null; enabled?: boolean } = {}): {
  games: GameVideo[] | null;
  byMatch: Map<string, GameVideo>;
  reload: () => void;
} {
  const enabled = opts.enabled ?? true;
  const [all, setAll] = useState<GameVideo[] | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      alive.current = false;
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void loadReady().then((rows) => {
      if (alive.current) setAll(rows);
    });
  }, [enabled, tick]);
  const games = useMemo(() => {
    if (!all) return null;
    if (opts.orgId === undefined || opts.orgId === null) return all;
    return all.filter((g) => g.orgId === opts.orgId);
  }, [all, opts.orgId]);
  const byMatch = useMemo(() => new Map((games ?? []).map((g) => [g.matchId, g])), [games]);
  const reload = useCallback(() => {
    invalidateCloudGames();
  }, []);
  return { games, byMatch, reload };
}
