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
import { listMatchesByIds } from "@/lib/matches-db";
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

function onMatchesChanged() {
  loadedGames.clear();
  const open = [...states].filter(([, state]) => state.tabs.length > 0);
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
