import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useNavigationType, type NavigateFunction } from "react-router-dom";
import {
  EMPTY_NAV_HISTORY,
  canGoForward,
  navCurrent,
  navPrevious,
  navStep,
  navTitle,
  pageOf,
  type NavEntry,
  type NavHistory,
} from "@scoutable/shared/lib/nav-history";

/**
 * The window's history as the coach walked it (packages/shared/lib/nav-history.ts): Back and Forward
 * (⌘[ ⌘], the mouse's side buttons, the toolbar's "‹ {page}") step through it as a browser does, so a game
 * opened from a team's plays goes back to those plays, and a team opened from a game goes back to the game.
 * docs/navigation.md.
 */

let history: NavHistory = EMPTY_NAV_HISTORY;
const listeners = new Set<() => void>();
let navigateRef: NavigateFunction | null = null;
/**
 * Every router location key seen, with the entry it was. A navigation renders as a transition (React Router 7):
 * the page being left stays on screen, and may render again, after the history has moved on. Read by its own
 * location key it keeps its own entry, so it never names the next page after itself or keeps its memory there.
 */
const idOfKey = new Map<string, number>();
/** Keys kept: far more than the history's entries, so a page still on screen always finds its own. */
const KEYS_KEPT = 1000;

function rememberKeys(h: NavHistory) {
  for (const e of h.entries) idOfKey.set(e.key, e.id);
  while (idOfKey.size > KEYS_KEPT) idOfKey.delete(idOfKey.keys().next().value!);
}

/** The next arrival comes from the sidebar (or a Go menu page): it starts afresh, with no back button. */
let nextIsRoot = false;

function set(next: NavHistory) {
  if (next === history) return;
  history = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useNavHistory(): NavHistory {
  return useSyncExternalStore(subscribe, () => history);
}

export function readNavHistory(): NavHistory {
  return history;
}

/** Called just before the sidebar (or the Go menu's pages) navigates. */
export function markNextNavRoot() {
  nextIsRoot = true;
}

/**
 * Follows the router into the history, and returns the entry on screen. Called once, by the layout around the
 * pages, during its render: the pages rendered under it read their own entry (useNavEntryId) at once.
 *
 * A new mount of the layout (the app starting, a sign-in after the sign-in page) starts the history over: the
 * pages walked before it are not this session's to go back to.
 */
export function useTrackNavHistory(): NavEntry | null {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  navigateRef = navigate;
  const path = location.pathname + location.search;
  const fresh = useRef(true);
  const current = navCurrent(history);
  let next = history;
  if (fresh.current && (!current || current.key !== location.key)) {
    next = navStep(EMPTY_NAV_HISTORY, "POP", { key: location.key, path, root: false });
  } else if (!current || current.key !== location.key) {
    const root = nextIsRoot;
    next = navStep(history, action, { key: location.key, path, root });
  }
  fresh.current = false;
  if (next !== history) {
    nextIsRoot = false;
    stepping = false;
    history = next;
    rememberKeys(next);
    // Listeners hear of it after the render (they are components; setting state in another's render warns).
    queueMicrotask(() => {
      for (const l of listeners) l();
    });
  }
  return navCurrent(history);
}

/**
 * The id of the page's own entry: stable while the page replaces its own entry (lib/page-memory.ts keys by it),
 * and still its own while the router moves on to the next page (idOfKey), never the entry now current.
 */
export function useNavEntryId(): number {
  // The page's own location: the tracker has stepped for it before the page renders.
  const location = useLocation();
  return idOfKey.get(location.key) ?? navCurrent(history)?.id ?? 0;
}

/**
 * The page names itself, for the back button of the page after it ("‹ Fryshuset") and the Back menu.
 * Named once it knows its name; a title that changes (a renamed playlist) follows.
 */
export function usePageTitle(title: string | null | undefined) {
  const id = useNavEntryId();
  useEffect(() => {
    if (title) set(navTitle(history, id, title));
  }, [id, title]);
}

/** Where a page goes back to when nothing was before it: its place in the app (Games for a game). */
export interface BackFallback {
  label: string;
  path: string;
}

export interface Back {
  /** What the button says: the page it returns to. */
  label: string;
  go: () => void;
  /** Back through history (as against up to the fallback). */
  history: boolean;
}

/**
 * The toolbar's way back. Behind this page is a page the coach came from: Back is that page, by name. Nothing
 * behind it (the app started here, the sidebar opened it): with a fallback, up to its place in the app; without
 * one (the sidebar's own pages), no button.
 */
export function useBack(fallback?: BackFallback): Back | null {
  const h = useNavHistory();
  const navigate = useNavigate();
  const current = navCurrent(h);
  const previous = navPrevious(h);
  const upPath = fallback?.path;
  const upLabel = fallback?.label;
  const viaHistory = !!previous && !(current?.root && !fallback);
  const label = viaHistory ? (previous!.title ?? titleOfPath(previous!.path)) : (upLabel ?? null);
  return useMemo<Back | null>(() => {
    if (label === null) return null;
    if (viaHistory) return { label, go: navBack, history: true };
    return { label, go: () => upPath && navigate(upPath), history: false };
  }, [label, viaHistory, upPath, navigate]);
}

export function canNavBack(): boolean {
  return navPrevious(history) !== null;
}

export function canNavForward(): boolean {
  return canGoForward(history);
}

/**
 * A step asked for and not yet taken: the router moves on popstate, after the call. Until it has, another
 * step (a held key's repeats, a second click) would be counted from where the history was, and could step
 * past its start into pages from before a reload.
 */
let stepping = false;
let steppingTimer: ReturnType<typeof setTimeout> | undefined;

function step(delta: -1 | 1) {
  if (stepping || !navigateRef) return;
  stepping = true;
  clearTimeout(steppingTimer);
  // A step that never lands (nothing that way after all) frees the next one.
  steppingTimer = setTimeout(() => (stepping = false), 500);
  navigateRef(delta);
}

/** ⌘[, the mouse's back button, the Go menu, the toolbar's back button. */
export function navBack() {
  if (canNavBack()) step(-1);
}

/** ⌘], the mouse's forward button, the Go menu. */
export function navForward() {
  if (canNavForward()) step(1);
}

/** A name for a page that never named itself (it was left before it loaded): its place in the app. */
export function titleOfPath(path: string): string {
  const page = pageOf(path);
  if (page.startsWith("/matches/")) return "Game";
  if (page === "/matches") return "Games";
  if (page.startsWith("/teams/")) return "Team";
  if (page === "/teams") return "Teams";
  if (page.startsWith("/reports/")) return "Report";
  if (page === "/reports") return "Reports";
  if (page.startsWith("/playlists")) return "Playlists";
  if (page.startsWith("/my-playlists")) return "Playlists";
  if (page.startsWith("/upload")) return "Import";
  if (page.startsWith("/settings")) return "Settings";
  if (page.startsWith("/profile")) return "Profile";
  if (page.startsWith("/organization")) return "Club";
  return "Back";
}
