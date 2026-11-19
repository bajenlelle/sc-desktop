/**
 * The desktop game page's tabs: the games a coach has open, in the order they
 * were opened (new ones on the right) unless the coach has dragged them into
 * another, and which were shown most recently.
 * Pure state; the desktop keeps it per user and space for the app session.
 *
 * Every function returns the state it was given when nothing changes, so a
 * store can skip notifying and React can skip rendering.
 */

export interface GameTab {
  id: string;
  title: string;
  date: string | null;
}

export interface GameTabs {
  /** Strip order: oldest opened on the left. */
  tabs: GameTab[];
  /** Ids, most recently shown first. */
  recent: string[];
}

/** Tabs at most; the one shown least recently gives way to a new game. */
export const GAME_TABS_MAX = 6;

export const NO_GAME_TABS: GameTabs = { tabs: [], recent: [] };

/**
 * Shows a game: an open one keeps its place and takes the newer title and
 * date (an empty title, a game still loading, never overwrites a known one);
 * a new one is appended, and at the cap the game shown least recently, never
 * this one, makes room.
 */
export function showGameTab(state: GameTabs, tab: GameTab, max: number = GAME_TABS_MAX): GameTabs {
  const open = state.tabs.find((t) => t.id === tab.id);
  if (open) {
    const title = tab.title || open.title;
    const date = tab.date ?? open.date;
    const same = title === open.title && date === open.date;
    if (same && state.recent[0] === tab.id) return state;
    return {
      tabs: same ? state.tabs : state.tabs.map((t) => (t === open ? { id: t.id, title, date } : t)),
      recent: [tab.id, ...state.recent.filter((id) => id !== tab.id)],
    };
  }
  const recent = [tab.id, ...state.recent.filter((id) => id !== tab.id)].slice(0, Math.max(1, max));
  const keep = new Set(recent);
  return {
    tabs: [...state.tabs, { id: tab.id, title: tab.title, date: tab.date }].filter((t) => keep.has(t.id)),
    recent,
  };
}

/**
 * Closes a game's tab. When it was the game shown (the most recent), `next`
 * is the tab on its right, else the one on its left; otherwise `next` is null
 * and the shown game stays.
 */
export function closeGameTab(state: GameTabs, id: string): { state: GameTabs; next: string | null } {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return { state, next: null };
  const tabs = state.tabs.filter((t) => t.id !== id);
  const next = state.recent[0] === id ? (state.tabs[index + 1]?.id ?? state.tabs[index - 1]?.id ?? null) : null;
  if (tabs.length === 0) return { state: NO_GAME_TABS, next: null };
  return { state: { tabs, recent: state.recent.filter((r) => r !== id) }, next };
}

/**
 * Puts the tabs in a new strip order (a tab was dragged). `order` is the ids
 * as they now stand; an id with no tab is ignored, and a tab it doesn't name
 * (opened while the drag was under way) keeps its place after the ones it
 * does. Which game was shown last doesn't change.
 */
export function orderGameTabs(state: GameTabs, order: readonly string[]): GameTabs {
  const byId = new Map(state.tabs.map((t) => [t.id, t]));
  const named = order.flatMap((id) => {
    const tab = byId.get(id);
    return tab ? [tab] : [];
  });
  const placed = new Set(named.map((t) => t.id));
  const tabs = [...named, ...state.tabs.filter((t) => !placed.has(t.id))];
  if (tabs.every((t, i) => t === state.tabs[i])) return state;
  return { tabs, recent: state.recent };
}

/** A tab that was closed and the place it stood in, for putting it back. */
export interface ClosedGameTab {
  tab: GameTab;
  index: number;
}

/**
 * The tabs a change closed, each with its place in the strip before: a tab
 * closed by the coach, or the one that made room for a seventh game. Several
 * closed at once (Close Other Tabs) count as closed one after the other from
 * the left, so a place counts only the tabs still there then: reopened the
 * last first, each is back where it stood.
 */
export function closedGameTabs(before: GameTabs, after: GameTabs): ClosedGameTab[] {
  if (before === after) return [];
  const open = new Set(after.tabs.map((t) => t.id));
  const closed: ClosedGameTab[] = [];
  before.tabs.forEach((tab, index) => {
    if (!open.has(tab.id)) closed.push({ tab, index: index - closed.length });
  });
  return closed;
}

/**
 * Puts a closed tab back where it stood (at the end when the strip is now
 * shorter) and shows it. At the cap the game shown least recently makes room,
 * never the one put back. A game opened again meanwhile is only shown.
 */
export function reopenGameTab(state: GameTabs, closed: ClosedGameTab, max: number = GAME_TABS_MAX): GameTabs {
  const { tab } = closed;
  if (state.tabs.some((t) => t.id === tab.id)) return showGameTab(state, tab, max);
  const at = Math.min(Math.max(0, closed.index), state.tabs.length);
  const recent = [tab.id, ...state.recent.filter((id) => id !== tab.id)].slice(0, Math.max(1, max));
  const keep = new Set(recent);
  const tabs = [...state.tabs.slice(0, at), { id: tab.id, title: tab.title, date: tab.date }, ...state.tabs.slice(at)];
  return { tabs: tabs.filter((t) => keep.has(t.id)), recent };
}

/** Closes every tab but one. */
export function closeOtherGameTabs(state: GameTabs, keepId: string): GameTabs {
  const keep = state.tabs.find((t) => t.id === keepId);
  if (!keep || state.tabs.length < 2) return state;
  return { tabs: [keep], recent: [keepId] };
}

/**
 * Where a key pressed on a tab moves the keyboard's focus, as tab lists do
 * (W3C's Tabs pattern): the arrows to the tab beside it, wrapping at the
 * ends, Home and End to the first and the last. Null for any other key.
 */
export function gameTabForKey(ids: readonly string[], focusedId: string, key: string): string | null {
  const at = ids.indexOf(focusedId);
  if (at < 0 || ids.length === 0) return null;
  if (key === "ArrowRight") return ids[(at + 1) % ids.length];
  if (key === "ArrowLeft") return ids[(at - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}

/**
 * A game's title as its two teams, when it is the "Home vs Away" a game is
 * given: a tab then cuts each team short by itself, so two games of the same
 * home team don't read the same. Null for a title the coach wrote.
 */
export function tabTitleParts(title: string): { home: string; away: string } | null {
  const at = title.indexOf(" vs ");
  if (at < 0) return null;
  const home = title.slice(0, at).trim();
  const away = title.slice(at + 4).trim();
  return home && away ? { home, away } : null;
}

/** The tab beside `activeId` in strip order, wrapping; null with nowhere to go. */
export function stepGameTab(state: GameTabs, activeId: string, step: 1 | -1): string | null {
  const n = state.tabs.length;
  if (n < 2) return null;
  const index = state.tabs.findIndex((t) => t.id === activeId);
  if (index < 0) return null;
  return state.tabs[(index + step + n) % n].id;
}

/**
 * Brings the tabs up to date with a fresh read of their games: a game that
 * didn't come back is gone (deleted, or no longer visible), one that now
 * belongs to another space has moved there, and the rest take their current
 * title and date. An empty read is taken as a failed one and changes nothing.
 * With `asked` (the ids the read was for), a tab outside it, opened while the
 * read was out, is kept as it is.
 */
export function reconcileGameTabs(
  state: GameTabs,
  found: readonly { id: string; title: string; date: string | null; orgId?: string | null }[],
  orgId: string | null,
  asked?: readonly string[],
): GameTabs {
  if (found.length === 0 || state.tabs.length === 0) return state;
  const byId = new Map(found.map((f) => [f.id, f]));
  const askedIds = asked ? new Set(asked) : null;
  let changed = false;
  const tabs: GameTab[] = [];
  for (const tab of state.tabs) {
    if (askedIds && !askedIds.has(tab.id)) {
      tabs.push(tab);
      continue;
    }
    const f = byId.get(tab.id);
    const elsewhere = f && f.orgId != null && orgId != null && f.orgId !== orgId;
    if (!f || elsewhere) {
      changed = true;
      continue;
    }
    const title = f.title || tab.title;
    const date = f.date ?? null;
    if (title === tab.title && date === tab.date) tabs.push(tab);
    else {
      changed = true;
      tabs.push({ id: tab.id, title, date });
    }
  }
  if (!changed) return state;
  if (tabs.length === 0) return NO_GAME_TABS;
  const ids = new Set(tabs.map((t) => t.id));
  return { tabs, recent: state.recent.filter((id) => ids.has(id)) };
}

/**
 * Reads stored tabs defensively: anything unreadable is no tabs, entries
 * without a string id are dropped and duplicates kept once, `recent` holds
 * exactly the open ids (missing ones appended in strip order), and more than
 * `max` tabs keep the `max` shown most recently.
 */
export function parseGameTabs(raw: string | null, max: number = GAME_TABS_MAX): GameTabs {
  if (!raw) return NO_GAME_TABS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NO_GAME_TABS;
  }
  if (!value || typeof value !== "object") return NO_GAME_TABS;
  const { tabs: rawTabs, recent: rawRecent } = value as { tabs?: unknown; recent?: unknown };
  if (!Array.isArray(rawTabs)) return NO_GAME_TABS;

  let tabs: GameTab[] = [];
  const seen = new Set<string>();
  for (const entry of rawTabs) {
    if (!entry || typeof entry !== "object") continue;
    const { id, title, date } = entry as { id?: unknown; title?: unknown; date?: unknown };
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    tabs.push({ id, title: typeof title === "string" ? title : "", date: typeof date === "string" ? date : null });
  }
  if (tabs.length === 0) return NO_GAME_TABS;

  let recent: string[] = [];
  const inRecent = new Set<string>();
  for (const id of Array.isArray(rawRecent) ? rawRecent : []) {
    if (typeof id !== "string" || !seen.has(id) || inRecent.has(id)) continue;
    inRecent.add(id);
    recent.push(id);
  }
  for (const tab of tabs) if (!inRecent.has(tab.id)) recent.push(tab.id);

  if (tabs.length > max) {
    recent = recent.slice(0, Math.max(0, max));
    const keep = new Set(recent);
    tabs = tabs.filter((t) => keep.has(t.id));
  }
  return { tabs, recent };
}
