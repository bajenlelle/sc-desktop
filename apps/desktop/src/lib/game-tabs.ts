/**
 * The open games (the game tabs, drawn as rows in the sidebar's Open games):
 * the games a coach has open, per user and space, kept across launches
 * (localStorage) and checked against the database the first time they are
 * read, so a game deleted or moved meanwhile doesn't come back. Signing out
 * forgets them. A tiny external store, so the sidebar and the page that
 * remounts on every switch read the same tabs without a provider. The pure
 * rules live in @scoutable/shared/lib/game-tabs.
 *
 * Also where each game was left in its video, across launches too, so a game
 * that comes back after a restart opens where the coach was.
 *
 * Also the games loaded on this visit, so a tab switch shows its game without
 * the spinner. Any `matches-changed` (a sync, a video, a title, an import, a
 * delete, a move to a club) empties that cache and reconciles the tabs with a
 * fresh read; an entry older than ten minutes is read again.
 *
 * And how each game was left, so it comes back that way: its filters, its
 * quarter zoom, its list scroll and its view. In memory for the app session:
 * filters hold Sets, and a webview reload is rare.
 *
 * Signing out does not reload the webview, so these and the game page's other
 * session caches (its playlists and labels) are dropped when the signed-in
 * user changes: another coach in the same club never sees this one's.
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  closedGameTabs,
  closeGameTab,
  closeOtherGameTabs as closeOtherTabs,
  GAME_TABS_MAX,
  NO_GAME_TABS,
  orderGameTabs,
  parseGameTabs,
  reconcileGameTabs,
  reopenGameTab,
  showGameTab,
  stepGameTab,
  type ClosedGameTab,
  type GameTab,
  type GameTabs,
} from "@scoutable/shared/lib/game-tabs";
import { EMPTY_GAME_FILTERS, type GameFilters } from "@scoutable/shared/lib/game-list";
import type { GameViewMode } from "@/components/game/game-view-switch";
import { forgetPlaylistsRead } from "@/components/game/use-collect";
import { shipScheduler } from "@/lib/background-ship";
import { listMatchesByIds } from "@/lib/matches-db";
import { createClient } from "@/lib/supabase/client";
import { forgetLabelsRead } from "@/lib/use-clip-labels";
import type { VideoFileStatus } from "@/lib/video-probe";
import type { StoredMatch } from "@/types/match";

export type { GameTab, GameTabs };

const KEY = "scoutable_game_tabs:";

/** A loaded game is served from the cache for this long at most. */
const LOADED_GAME_MS = 10 * 60_000;

/** One set of tabs per user and space; null while either is unknown. */
export function gameTabsScope(userId: string | null | undefined, orgId: string | null | undefined): string | null {
  return userId && orgId ? `${userId}:${orgId}` : null;
}

const states = new Map<string, GameTabs>();
const listeners = new Set<() => void>();

function read(scope: string | null): GameTabs {
  if (!scope) return NO_GAME_TABS;
  let state = states.get(scope);
  if (!state) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY + scope);
    } catch {
      /* storage unavailable: start with no tabs */
    }
    state = parseGameTabs(raw);
    states.set(scope, state);
    // Kept from an earlier launch: the games may have been deleted, renamed or moved since.
    if (state.tabs.length > 0) queueMicrotask(() => checkRestored(scope));
  }
  return state;
}

function write(scope: string | null, next: GameTabs) {
  if (!scope || read(scope) === next) return;
  states.set(scope, next);
  try {
    if (next.tabs.length === 0) localStorage.removeItem(KEY + scope);
    else localStorage.setItem(KEY + scope, JSON.stringify(next));
  } catch {
    /* private mode or quota: the tabs still work until the app quits */
  }
  for (const listener of listeners) listener();
}

/** Brings tabs read from storage up to date with their games, once per launch and scope. */
function checkRestored(scope: string) {
  const ids = read(scope).tabs.map((t) => t.id);
  if (ids.length === 0) return;
  const orgId = scope.slice(scope.indexOf(":") + 1) || null;
  listMatchesByIds(ids)
    .then((matches) => {
      const found = matches.map((m) => ({ id: m.id, title: m.title, date: m.date || null, orgId: m.orgId }));
      write(scope, reconcileGameTabs(read(scope), found, orgId, ids));
    })
    .catch(() => {
      /* a failed read keeps the tabs as they are; opening a game that's gone says so and closes its tab */
    });
}

/** Forgets a user's open games on this computer: they signed out. */
function forgetUsersTabs(userId: string) {
  const prefix = `${userId}:`;
  for (const scope of [...states.keys()]) if (scope.startsWith(prefix)) states.delete(scope);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY + prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was kept */
  }
  for (const listener of listeners) listener();
}

/**
 * The tabs closed on this visit, per scope, the last closed last: what Reopen
 * Closed Tab brings back. Kept in memory only, and only for tabs the coach
 * closed or that made room for another game; a game that was deleted or moved
 * to another space is not something to reopen.
 */
const closedTabs = new Map<string, ClosedGameTab[]>();
const CLOSED_TABS_MAX = 10;

/** Notes what a change closed (and that a reopened game is no longer closed), then writes it. */
function writeNoting(scope: string, next: GameTabs): ClosedGameTab[] {
  const before = read(scope);
  if (before === next) return [];
  const gone = closedGameTabs(before, next);
  const open = new Set(next.tabs.map((t) => t.id));
  const kept = (closedTabs.get(scope) ?? []).filter((c) => !open.has(c.tab.id) && !gone.some((g) => g.tab.id === c.tab.id));
  closedTabs.set(scope, [...kept, ...gone].slice(-CLOSED_TABS_MAX));
  write(scope, next);
  return gone;
}

let watching = false;
/** The user the caches belong to; undefined until the auth listener first says. */
let cachedFor: string | null | undefined;

function onAuthChanged(userId: string | null) {
  // Signed out: their open games don't stay on the computer for whoever signs in next.
  if (cachedFor && userId === null) forgetUsersTabs(cachedFor);
  if (cachedFor !== undefined && userId !== cachedFor) {
    loadedGames.clear();
    gameViews.clear();
    closedTabs.clear();
    forgetPlaylistsRead();
    forgetLabelsRead();
    // Clips still waiting to go out belong to the user who added them: nothing is sent under the next one.
    shipScheduler.cancelAll();
  }
  cachedFor = userId;
}

function onMatchesChanged() {
  loadedGames.clear();
  // Only the signed-in user's tabs (all, before the auth listener first says): another's games are read under this one's access.
  const mine = (scope: string) => cachedFor === undefined || (cachedFor !== null && scope.startsWith(`${cachedFor}:`));
  const open = [...states].filter(([scope, state]) => mine(scope) && state.tabs.length > 0);
  const ids = [...new Set(open.flatMap(([, state]) => state.tabs.map((t) => t.id)))];
  if (ids.length === 0) return;
  listMatchesByIds(ids)
    .then((matches) => {
      const found = matches.map((m) => ({ id: m.id, title: m.title, date: m.date || null, orgId: m.orgId }));
      // Only the games asked about: one opened while the read was out stays.
      for (const [scope] of open) {
        const orgId = scope.slice(scope.indexOf(":") + 1) || null;
        write(scope, reconcileGameTabs(read(scope), found, orgId, ids));
      }
    })
    .catch(() => {
      /* a failed read keeps the tabs as they are */
    });
}

function subscribe(listener: () => void) {
  if (!watching) {
    watching = true;
    window.addEventListener("matches-changed", onMatchesChanged);
    // Registered when the window's layout first draws the tab bar, at launch: the caches are that first event's user's.
    createClient().auth.onAuthStateChange((_event, session) => onAuthChanged(session?.user.id ?? null));
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGameTabs(scope: string | null): GameTabs {
  return useSyncExternalStore(
    subscribe,
    () => read(scope),
    () => read(scope),
  );
}

/**
 * Shows a game in the scope's tabs: its own tab, now the most recent. Returns
 * the tab that made room for it, when the bar was full: that one was closed
 * without being asked, so the page says so.
 */
export function rememberGameTab(scope: string | null, tab: GameTab): GameTab | null {
  if (!scope) return null;
  return writeNoting(scope, showGameTab(read(scope), tab))[0]?.tab ?? null;
}

/**
 * Closes a game's tab; returns the game to show instead when it was the shown
 * one. `reopenable: false` for a tab whose game is gone: there is nothing to
 * bring back.
 */
export function forgetGameTab(scope: string | null, id: string, opts: { reopenable?: boolean } = {}): string | null {
  if (!scope) return null;
  const { state, next } = closeGameTab(read(scope), id);
  if (opts.reopenable === false) write(scope, state);
  else writeNoting(scope, state);
  return next;
}

/** Closes every tab of the scope but one. */
export function closeOtherGameTabs(scope: string | null, keepId: string): void {
  if (!scope) return;
  writeNoting(scope, closeOtherTabs(read(scope), keepId));
}

/**
 * Puts the tab closed last back in its place and shows it. Returns its game,
 * and the tab that made room for it when the bar was full; null with nothing
 * to reopen.
 */
export function reopenClosedGameTab(scope: string | null): { id: string; evicted: GameTab | null } | null {
  if (!scope) return null;
  const closed = closedTabs.get(scope) ?? [];
  const last = closed[closed.length - 1];
  if (!last) return null;
  const gone = writeNoting(scope, reopenGameTab(read(scope), last));
  // Already open (its tab came back another way): no longer something to reopen.
  closedTabs.set(scope, (closedTabs.get(scope) ?? []).filter((c) => c.tab.id !== last.tab.id));
  for (const listener of listeners) listener();
  return { id: last.tab.id, evicted: gone[0]?.tab ?? null };
}

/** Whether the scope has a closed tab to bring back. */
export function useHasClosedGameTab(scope: string | null): boolean {
  const has = () => !!scope && (closedTabs.get(scope)?.length ?? 0) > 0;
  return useSyncExternalStore(subscribe, has, has);
}

/** Puts the scope's tabs in the order they were dragged into. */
export function reorderGameTabs(scope: string | null, order: readonly string[]): void {
  if (!scope) return;
  write(scope, orderGameTabs(read(scope), order));
}

/** The tab beside `activeId` in strip order, wrapping; null with nowhere to go. */
export function neighbourGameTab(scope: string | null, activeId: string, step: 1 | -1): string | null {
  return stepGameTab(read(scope), activeId, step);
}

const POSITIONS_KEY = "scoutable_game_positions";
/** Games whose place in the video is kept: the most recently left. */
const POSITIONS_MAX = 30;

function readPositions(): [string, number][] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (e): e is [string, number] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0,
    );
  } catch {
    return [];
  }
}

/** Where a game was left in its video, in seconds; null for a game not left yet (or forgotten). */
export function recallGamePosition(matchId: string): number | null {
  return readPositions().find(([id]) => id === matchId)?.[1] ?? null;
}

/** Notes where a game is in its video; the thirty games left most recently are kept. */
export function rememberGamePosition(matchId: string, seconds: number): void {
  if (!(seconds > 0)) return;
  const first: [string, number] = [matchId, seconds];
  const next: [string, number][] = [first, ...readPositions().filter(([id]) => id !== matchId)].slice(0, POSITIONS_MAX);
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(next));
  } catch {
    /* the game opens at tip-off next time */
  }
}

type LoadedGame = { match: StoredMatch; videoStatus: VideoFileStatus | "none" };

/** The games read on this visit, least recently used first; one more than the tabs, so the leaving game's copy stays. */
const loadedGames = new Map<string, { entry: LoadedGame; at: number }>();

export function recallLoadedGame(id: string): LoadedGame | null {
  const cached = loadedGames.get(id);
  if (!cached) return null;
  loadedGames.delete(id);
  if (Date.now() - cached.at > LOADED_GAME_MS) return null;
  // Shown again: the newest in eviction order, its age unchanged.
  loadedGames.set(id, cached);
  return cached.entry;
}

export function rememberLoadedGame(id: string, entry: LoadedGame): void {
  loadedGames.delete(id);
  loadedGames.set(id, { entry, at: Date.now() });
  while (loadedGames.size > GAME_TABS_MAX + 1) {
    const oldest = loadedGames.keys().next().value;
    if (oldest === undefined) break;
    loadedGames.delete(oldest);
  }
}

/** How a game was left. Not kept: the filter sheet's open state, the selection, and this visit's undoable adds. */
export interface GameViewMemory {
  filters: GameFilters;
  zoomPeriod: number | null;
  /** The play list's scroll, and whether it was following playback. */
  list: { top: number; following: boolean } | null;
  view: GameViewMode | null;
  /** The Stats view as it was left: its scroll, and whether the players' table showed the season. */
  stats: { top: number; season: boolean } | null;
}

const gameViews = new Map<string, GameViewMemory>();

export function recallGameView(matchId: string): GameViewMemory | null {
  return gameViews.get(matchId) ?? null;
}

export function rememberGameView(matchId: string, patch: Partial<GameViewMemory>): void {
  const was = gameViews.get(matchId) ?? { filters: EMPTY_GAME_FILTERS, zoomPeriod: null, list: null, view: null, stats: null };
  gameViews.set(matchId, { ...was, ...patch });
}

/**
 * Says that a tab was closed to make room (six games stay open), with the way
 * to bring it back. The Reopen button asks as the File menu's item does, so
 * the tabs' keys (components/game/game-tab-keys.tsx) answer it. It stays twice as long as the app's other notices:
 * nobody asked for that tab to close, and its two lines take reading.
 */
export function announceClosedGameTab(title: string): void {
  toast(`Closed ${title || "a game"} to make room: up to six games stay open`, {
    id: "game-tab-made-room",
    duration: 8000,
    action: { label: "Reopen", onClick: () => window.dispatchEvent(new CustomEvent("menu-reopen-game-tab")) },
  });
}
