"use client";

/**
 * Cloud game videos on the web: the viewer's own rows (RLS shows nobody
 * else's) in every state, the presigned play URLs the `game-video` function
 * mints for the ready ones, and the poll that follows a row while our
 * converter works on it.
 *
 * URLs live 12 hours and are shared by every component on the page through
 * a module cache, so a game is signed once per visit; a URL inside its last
 * ten minutes is treated as gone and fetched again. The row list is a
 * short-lived memo shared by the sidebar, the tab bar and the pages.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playGameVideo } from "@scoutable/shared/lib/game-video-client";
import { isSignedUrlFresh, type GameVideoPlayResponse, type GameVideoStatus } from "@scoutable/shared/lib/game-video-wire";
import { gameVideoIsSettling, gameVideoListPollMs, getGameVideoForMatch, listMyGameVideos, type GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { trackEvent } from "@/lib/analytics";
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

// ---------------------------------------------------------------------------
// My rows
// ---------------------------------------------------------------------------

/** Fired on window when a game's cloud video changed here (an upload finished, was cancelled or removed), with `{ matchId, expect }`. */
export const GAME_VIDEO_CHANGED = "game-video-changed";

/** What the row is known to be now, before it has been read again; "removed" = gone. */
export type GameVideoExpectation = GameVideoStatus | "removed";

interface GameVideoChangeDetail {
  matchId: string;
  expect?: GameVideoExpectation;
}

/**
 * Tells every list and row hook that a game's video changed. `expect` lets
 * the row hook show the new state at once instead of the old one for the
 * length of a re-read (an upload that just completed is converting, not
 * interrupted).
 */
export function announceGameVideoChange(matchId: string, expect?: GameVideoExpectation) {
  invalidateGameVideos();
  window.dispatchEvent(new CustomEvent<GameVideoChangeDetail>(GAME_VIDEO_CHANGED, { detail: { matchId, expect } }));
}

/** A short-lived memo of "my rows, every state", shared by the sidebar, the tab bar and the pages. */
let rowsCache: { at: number; promise: Promise<GameVideo[]> } | null = null;
const ROWS_TTL_MS = 60_000;
const listeners = new Set<() => void>();

/** Each mounted list with a settling row asks for a pace; one timer re-reads at the fastest one asked. */
const pollClaims = new Map<symbol, number>();
let pollTimer: number | null = null;
let pollEvery = 0;

function schedulePoll() {
  const next = pollClaims.size > 0 ? Math.min(...pollClaims.values()) : 0;
  if (next === pollEvery && (pollTimer !== null) === next > 0) return;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  pollEvery = next;
  if (next > 0) {
    pollTimer = window.setInterval(() => {
      if (!document.hidden) invalidateGameVideos();
    }, next);
  }
}

function loadRows(): Promise<GameVideo[]> {
  if (rowsCache && Date.now() - rowsCache.at < ROWS_TTL_MS) return rowsCache.promise;
  const promise = listMyGameVideos(createClient());
  rowsCache = { at: Date.now(), promise };
  return promise;
}

/** The viewer's ready copies, from the same short-lived memo the hooks below use. */
export function fetchMyCloudGames(): Promise<GameVideo[]> {
  return loadRows().then((rows) => rows.filter((r) => r.status === "ready"));
}

/** Forgets the cached list (after a change elsewhere) and tells every subscriber to reload. */
export function invalidateGameVideos() {
  rowsCache = null;
  for (const l of listeners) l();
}

/** The older name, kept for the callers that have it. */
export const invalidateCloudGames = invalidateGameVideos;

/**
 * The viewer's games in the cloud, in every state (uploading, converting,
 * ready, failed). Null while loading. Scoped to a space when `orgId` is
 * given (a row carries the game's space); the player-only navigation passes
 * none and sees them all. `status` narrows to one state.
 */
export function useMyGameVideos(opts: { orgId?: string | null; enabled?: boolean; status?: GameVideoStatus } = {}): {
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
    void loadRows().then((rows) => {
      if (alive.current) setAll(rows);
    });
  }, [enabled, tick]);
  const inSpace = useMemo(() => {
    if (!all) return null;
    return opts.orgId !== undefined && opts.orgId !== null ? all.filter((g) => g.orgId === opts.orgId) : all;
  }, [all, opts.orgId]);
  // A list with a row our converter is working on in its space (whatever
  // state it shows) reads itself again while the tab is visible, so
  // "Converting" turns into the finished row without a navigation. One
  // module poller serves every mounted list (the sidebar, the tab bar and
  // the page each hold one).
  const claim = useRef<symbol>(Symbol("game-video-poll"));
  useEffect(() => {
    // Re-judged on every read (each brings new rows), so the pace slows once
    // the settling rows have been at it a while.
    const pollMs = enabled && inSpace ? gameVideoListPollMs(inSpace, Date.now()) : null;
    if (pollMs === null) return;
    const key = claim.current;
    pollClaims.set(key, pollMs);
    schedulePoll();
    return () => {
      pollClaims.delete(key);
      schedulePoll();
    };
  }, [enabled, inSpace]);
  const games = useMemo(() => {
    if (!inSpace) return null;
    return opts.status ? inSpace.filter((g) => g.status === opts.status) : inSpace;
  }, [inSpace, opts.status]);
  const byMatch = useMemo(() => new Map((games ?? []).map((g) => [g.matchId, g])), [games]);
  const reload = useCallback(() => {
    invalidateGameVideos();
  }, []);
  return { games, byMatch, reload };
}

/**
 * The viewer's games with a READY cloud copy, the ones that play. The
 * playlists depend on this meaning (a clip of one of them plays as a window
 * of the copy), so it stays ready-only; useMyGameVideos has every state.
 */
export function useMyCloudGames(opts: { orgId?: string | null; enabled?: boolean } = {}): {
  games: GameVideo[] | null;
  byMatch: Map<string, GameVideo>;
  reload: () => void;
} {
  return useMyGameVideos({ ...opts, status: "ready" });
}

// ---------------------------------------------------------------------------
// One game's row
// ---------------------------------------------------------------------------

/** How often the row is read while our converter works on it, and after two minutes of that. */
const POLL_MS = 5_000;
const POLL_SLOW_MS = 15_000;
const POLL_SLOW_AFTER_MS = 2 * 60_000;

/**
 * The row that speaks for a game (getGameVideoForMatch), kept current: read
 * again whenever this device changes it (GAME_VIDEO_CHANGED) and polled
 * every 5 s while the converter works or hasn't reported its sync yet (15 s
 * after two minutes, paused while the tab is hidden, at once when it comes
 * back). Fires the conversion's analytics when the row settles under watch.
 */
export function useGameVideoRow(
  matchId: string | null,
  opts: { enabled?: boolean } = {},
): { video: GameVideo | null; loaded: boolean; reload: () => Promise<void> } {
  const enabled = (opts.enabled ?? true) && !!matchId;
  const [state, setState] = useState<{ matchId: string; video: GameVideo | null } | null>(null);
  const alive = useRef(true);
  const lastRef = useRef<GameVideo | null>(null);
  const pollStartedRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!matchId) return;
    const video = await getGameVideoForMatch(createClient(), matchId);
    if (!alive.current) return;
    const last = lastRef.current;
    if (last && last.matchId === matchId && last.status === "converting" && video && video.id === last.id) {
      if (video.status === "ready") {
        trackEvent("game_video_converted", {
          match_id: matchId,
          sync_status: video.syncStatus,
          confidence: video.suggestedConfidence,
          wall_s: Math.round((Date.now() - Date.parse(video.createdAt)) / 1000),
        });
      } else if (video.status === "failed") {
        trackEvent("game_video_convert_failed", { match_id: matchId, error: video.convertError });
      }
    }
    lastRef.current = video;
    setState({ matchId, video });
  }, [matchId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The first read, and one after every change announced on this device;
  // what the announcement says the row is now shows meanwhile.
  useEffect(() => {
    if (!enabled) return;
    void load();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<GameVideoChangeDetail>).detail;
      if (detail?.matchId !== matchId) return;
      if (detail.expect) {
        setState((prev) => {
          if (prev?.matchId !== matchId) return prev;
          if (detail.expect === "removed") return { matchId, video: null };
          return prev.video ? { matchId, video: { ...prev.video, status: detail.expect! } } : prev;
        });
      }
      void load();
    };
    window.addEventListener(GAME_VIDEO_CHANGED, onChange);
    return () => window.removeEventListener(GAME_VIDEO_CHANGED, onChange);
  }, [enabled, matchId, load]);

  const loaded = state?.matchId === matchId;
  const video = loaded ? state.video : null;
  const settling = enabled && gameVideoIsSettling(video);

  useEffect(() => {
    if (!settling) {
      pollStartedRef.current = null;
      return;
    }
    pollStartedRef.current ??= Date.now();
    let timer: number | undefined;
    const schedule = () => {
      const slow = Date.now() - (pollStartedRef.current ?? Date.now()) > POLL_SLOW_AFTER_MS;
      timer = window.setTimeout(tick, slow ? POLL_SLOW_MS : POLL_MS);
    };
    const tick = () => {
      // A hidden tab waits; the next look happens when it comes back.
      if (document.hidden) return;
      void load().finally(schedule);
    };
    const onVisible = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void load().finally(schedule);
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [settling, load]);

  return { video, loaded, reload: load };
}
