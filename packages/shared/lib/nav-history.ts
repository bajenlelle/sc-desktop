/**
 * The app's own record of where the coach has been, as the router steps through it: the pages behind
 * and ahead of the current one, each with the name it showed. Back and Forward walk it as Safari's or
 * Finder's do (history, not hierarchy), and the back button names the page it returns to
 * ("‹ Fryshuset"). docs/navigation.md.
 *
 * An entry outlives the router's replaces (a page's own switch between its views, a tab switch, a cleared
 * one-shot state): it keeps its id, so what is remembered for it (lib/page-memory.ts on desktop) holds,
 * and only its key and path follow the router.
 */

export type NavAction = "PUSH" | "REPLACE" | "POP";

export interface NavEntry {
  /** Ours: stable across replaces. */
  id: number;
  /** The router's location key, which a replace changes. */
  key: string;
  /** Path and search, as the router shows it. */
  path: string;
  /** The name the page gave itself (usePageTitle), null until it has. */
  title: string | null;
  /** Arrived at from the sidebar: a fresh start, so its toolbar shows no way back (⌘[ still goes back). */
  root: boolean;
}

export interface NavHistory {
  entries: NavEntry[];
  index: number;
  nextId: number;
}

export const EMPTY_NAV_HISTORY: NavHistory = { entries: [], index: -1, nextId: 1 };

/** The location the router moved to, and whether the move came from the sidebar. */
export interface NavArrival {
  key: string;
  path: string;
  root: boolean;
}

/** At most this many entries are kept; the oldest go first. */
export const NAV_HISTORY_LIMIT = 100;

export function navStep(h: NavHistory, action: NavAction, at: NavArrival): NavHistory {
  const current = h.entries[h.index];
  if (action === "REPLACE" && current) {
    const samePage = pageOf(current.path) === pageOf(at.path);
    const entries = h.entries.slice();
    // A replace onto another page (a switch between open games) starts that page's name afresh.
    entries[h.index] = { ...current, key: at.key, path: at.path, title: samePage ? current.title : null, root: current.root || at.root };
    return { ...h, entries };
  }
  if (action === "POP") {
    const found = h.entries.findIndex((e) => e.key === at.key);
    if (found >= 0) return { ...h, index: found };
    // A step to an entry we never saw (the start, a reload): what lies around it is unknown, so it starts over.
    return { entries: [fresh(h.nextId, at)], index: 0, nextId: h.nextId + 1 };
  }
  // A push, or a replace with nothing recorded yet.
  let entries = [...h.entries.slice(0, h.index + 1), fresh(h.nextId, at)];
  if (entries.length > NAV_HISTORY_LIMIT) entries = entries.slice(entries.length - NAV_HISTORY_LIMIT);
  return { entries, index: entries.length - 1, nextId: h.nextId + 1 };
}

/** The current page names itself. */
export function navTitle(h: NavHistory, id: number, title: string): NavHistory {
  const i = h.entries.findIndex((e) => e.id === id);
  if (i < 0 || h.entries[i].title === title) return h;
  const entries = h.entries.slice();
  entries[i] = { ...entries[i], title };
  return { ...h, entries };
}

export function navCurrent(h: NavHistory): NavEntry | null {
  return h.entries[h.index] ?? null;
}

export function navPrevious(h: NavHistory): NavEntry | null {
  return h.index > 0 ? h.entries[h.index - 1] : null;
}

export function canGoForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/** The path without its search: a page's own views (?view=, ?play=) are the same page. */
export function pageOf(path: string): string {
  const q = path.indexOf("?");
  return q < 0 ? path : path.slice(0, q);
}

function fresh(id: number, at: NavArrival): NavEntry {
  return { id, key: at.key, path: at.path, title: null, root: at.root };
}
