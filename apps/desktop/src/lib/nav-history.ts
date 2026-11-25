import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useNavigationType, type NavigateFunction } from "react-router-dom";
import {
  EMPTY_NAV_HISTORY,
  canGoForward,
  navCurrent,
  navPrevious,
  navStep,
  navTitle,
  pageOf,
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
 * Follows the router into the history. Rendered once, inside the router, above the pages, and rendered
 * before them so a page's first effects already see their own entry.
 */
export function NavHistoryTracker() {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  navigateRef = navigate;
  const path = location.pathname + location.search;
  // During render, so the page rendered for this location reads its own entry (useNavEntryId) at once.
  const current = navCurrent(history);
  if (!current || current.key !== location.key) {
    const root = nextIsRoot;
    nextIsRoot = false;
    history = navStep(history, action, { key: location.key, path, root });
    // Listeners hear of it after the render (they are components; setting state in another's render warns).
    queueMicrotask(() => {
      for (const l of listeners) l();
    });
  }
  return null;
}

/** The id of the entry on screen: stable while the page replaces its own entry (lib/page-memory.ts keys by it). */
export function useNavEntryId(): number {
  // The location ties a render to the tracker's step for it.
  useLocation();
  return navCurrent(history)?.id ?? 0;
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
    if (viaHistory) return { label, go: () => navigate(-1), history: true };
    return { label, go: () => upPath && navigate(upPath), history: false };
  }, [label, viaHistory, upPath, navigate]);
}

export function canNavBack(): boolean {
  return navPrevious(history) !== null;
}

export function canNavForward(): boolean {
  return canGoForward(history);
}

/** ⌘[, the mouse's back button, the Go menu. */
export function navBack() {
  if (canNavBack()) navigateRef?.(-1);
}

/** ⌘], the mouse's forward button, the Go menu. */
export function navForward() {
  if (canNavForward()) navigateRef?.(1);
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
