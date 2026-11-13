/**
 * The game page's tabs: the games a coach has open, per user and space, for
 * the app session (sessionStorage). A tiny external store, so the page that
 * remounts on every switch reads the same tabs without a provider. The pure
 * rules live in @scoutable/shared/lib/game-tabs.
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
import {
  closeGameTab,
  GAME_TABS_MAX,
  NO_GAME_TABS,
  parseGameTabs,
  reconcileGameTabs,
  showGameTab,
  stepGameTab,
  type GameTab,
  type GameTabs,
} from "@scoutable/shared/lib/game-tabs";
import { EMPTY_GAME_FILTERS, type GameFilters } from "@scoutable/shared/lib/game-list";
import type { GameViewMode } from "@/components/game/game-view-switch";
import { forgetPlaylistsRead } from "@/components/game/use-collect";
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
      raw = sessionStorage.getItem(KEY + scope);
    } catch {
      /* storage unavailable: start with no tabs */
    }
    state = parseGameTabs(raw);
    states.set(scope, state);
  }
  return state;
}

function write(scope: string | null, next: GameTabs) {
  if (!scope || read(scope) === next) return;
  states.set(scope, next);
  try {
    sessionStorage.setItem(KEY + scope, JSON.stringify(next));
  } catch {
    /* private mode or quota: the tabs still work for this page's life */
  }
  for (const listener of listeners) listener();
}

let watching = false;
/** The user the caches belong to; undefined until the auth listener first says. */
let cachedFor: string | null | undefined;

function onAuthChanged(userId: string | null) {
  if (cachedFor !== undefined && userId !== cachedFor) {
    loadedGames.clear();
    gameViews.clear();
    forgetPlaylistsRead();
    forgetLabelsRead();
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
    // Registered with the first game page, whose caches are its first event's user's.
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

/** Shows a game in the scope's tabs: its own tab, now the most recent. */
export function rememberGameTab(scope: string | null, tab: GameTab): void {
  if (!scope) return;
  write(scope, showGameTab(read(scope), tab));
}

/** Closes a game's tab; returns the game to show instead when it was the shown one. */
export function forgetGameTab(scope: string | null, id: string): string | null {
  if (!scope) return null;
  const { state, next } = closeGameTab(read(scope), id);
  write(scope, state);
  return next;
}

/** The tab beside `activeId` in strip order, wrapping; null with nowhere to go. */
export function neighbourGameTab(scope: string | null, activeId: string, step: 1 | -1): string | null {
  return stepGameTab(read(scope), activeId, step);
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
}

const gameViews = new Map<string, GameViewMemory>();

export function recallGameView(matchId: string): GameViewMemory | null {
  return gameViews.get(matchId) ?? null;
}

export function rememberGameView(matchId: string, patch: Partial<GameViewMemory>): void {
  const was = gameViews.get(matchId) ?? { filters: EMPTY_GAME_FILTERS, zoomPeriod: null, list: null, view: null };
  gameViews.set(matchId, { ...was, ...patch });
}
