/**
 * The open teams (rows in the sidebar's Open teams, docs/teams.md): the teams
 * a coach has visited, per user and space, kept across launches (localStorage)
 * and forgotten on sign-out, by the open games' own rules
 * (@scoutable/shared/lib/game-tabs; ids from lib/team-tabs). Six at most: the
 * team shown least recently makes room without a word, since every team is
 * one click away under Teams.
 *
 * Also how each team was left (Season or Plays, the side, the pick: its page's
 * search and router state), in memory for the app session, so a row opens it
 * that way.
 */
import { useSyncExternalStore } from "react";
import {
  closeGameTab,
  closeOtherGameTabs,
  NO_GAME_TABS,
  orderGameTabs,
  parseGameTabs,
  showGameTab,
  type GameTabs,
} from "@scoutable/shared/lib/game-tabs";
import { createClient } from "@/lib/supabase/client";

export type TeamTabs = GameTabs;

const KEY = "scoutable_team_tabs:";

const states = new Map<string, TeamTabs>();
const listeners = new Set<() => void>();

function read(scope: string | null): TeamTabs {
  if (!scope) return NO_GAME_TABS;
  let state = states.get(scope);
  if (!state) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY + scope);
    } catch {
      /* storage unavailable: start with none open */
    }
    state = parseGameTabs(raw);
    states.set(scope, state);
  }
  return state;
}

function write(scope: string | null, next: TeamTabs) {
  if (!scope || read(scope) === next) return;
  states.set(scope, next);
  try {
    if (next.tabs.length === 0) localStorage.removeItem(KEY + scope);
    else localStorage.setItem(KEY + scope, JSON.stringify(next));
  } catch {
    /* private mode or quota: the rows still work until the app quits */
  }
  for (const listener of listeners) listener();
}

/** How each team was left: its page's search ("?view=plays") and router state. */
const left = new Map<string, { search: string; state: unknown }>();

let watching = false;
let signedIn: string | null | undefined;

/** Signed out: their open teams don't stay on the computer for whoever signs in next. */
function onAuthChanged(userId: string | null) {
  if (signedIn && userId === null) {
    const prefix = `${signedIn}:`;
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
  if (signedIn !== undefined && userId !== signedIn) left.clear();
  signedIn = userId;
}

function subscribe(listener: () => void) {
  if (!watching) {
    watching = true;
    createClient().auth.onAuthStateChange((_event, session) => onAuthChanged(session?.user.id ?? null));
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The scope's open teams; the scope is the open games' (lib/game-tabs gameTabsScope). */
export function useTeamTabs(scope: string | null): TeamTabs {
  return useSyncExternalStore(
    subscribe,
    () => read(scope),
    () => read(scope),
  );
}

/** A team's page is on screen: it is open, the most recent, with its name once known. */
export function rememberTeamTab(scope: string | null, id: string, title: string): void {
  write(scope, showGameTab(read(scope), { id, title, date: null }));
}

/** Closes a team's row. */
export function forgetTeamTab(scope: string | null, id: string): void {
  if (!scope) return;
  write(scope, closeGameTab(read(scope), id).state);
}

/** Closes every row of the scope but one. */
export function closeOtherTeamTabs(scope: string | null, keepId: string): void {
  if (!scope) return;
  write(scope, closeOtherGameTabs(read(scope), keepId));
}

/** Puts the scope's rows in the order they were dragged into. */
export function reorderTeamTabs(scope: string | null, order: readonly string[]): void {
  if (!scope) return;
  write(scope, orderGameTabs(read(scope), order));
}

export function rememberTeamLeft(id: string, search: string, state: unknown): void {
  left.set(id, { search, state });
}

export function recallTeamLeft(id: string): { search: string; state: unknown } | null {
  return left.get(id) ?? null;
}
