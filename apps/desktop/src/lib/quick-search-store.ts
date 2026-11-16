/**
 * The search over a space (⌘K, Ctrl+K, the sidebar's Search; docs/search.md):
 * whether its panel is open, and the index it searches.
 *
 * Nothing is read until the panel first opens. Then the space's playlists,
 * folders, reports and games are read once with light selects (names, dates
 * and statuses; never clips, rosters or plays) and kept in memory, so typing
 * never waits for the network. No event announces a renamed playlist or a new
 * report, so every later open shows the index it has at once and reads it
 * again behind it. One space is kept at a time: another space or user starts
 * over.
 */
import { useSyncExternalStore } from "react";
import { buildSearchIndex, type SearchIndex } from "@scoutable/shared/lib/quick-search";
import { mergeReportList } from "@scoutable/shared/lib/scouting-report-list";
import { trackEvent } from "@/lib/analytics";
import { listFolders, listMatchIndex } from "@/lib/matches-db";
import { listPlaylistIndex } from "@/lib/playlists-db";
import { listReportDraftTitles } from "@/lib/report-drafts-db";
import { listMyScoutingReports } from "@/lib/scouting-reports-db";

/** How the panel was asked for: the chord (or Go > Search…), or the sidebar's row. */
export type SearchVia = "shortcut" | "sidebar";

/** Whose index: a user in a space. `personal` takes in the content from before spaces, as the pages do. */
export interface SearchScope {
  userId: string;
  orgId: string;
  personal: boolean;
}

export type SearchIndexState =
  | { status: "loading"; index: null }
  | { status: "error"; index: null }
  | { status: "ready"; index: SearchIndex };

const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let open = false;
/** Whether the page shown has a search at all (the coach's workspace); set by the host. */
let available = false;

const scopeKey = (s: SearchScope) => `${s.userId}:${s.orgId}:${s.personal}`;
let held: { key: string; state: SearchIndexState; reading: boolean } | null = null;
const LOADING: SearchIndexState = { status: "loading", index: null };

/** Another dialog, sheet, popover or menu is open: the search stays out of its way. */
function somethingElseIsOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"]:not([data-quick-search]), [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}

export function useQuickSearchOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => open);
}

/** The host says whether this page has the search; it closes with the page. */
export function setQuickSearchAvailable(next: boolean): void {
  available = next;
  if (!next && open) closeQuickSearch();
}

export function openQuickSearch(via: SearchVia): void {
  if (open || !available || somethingElseIsOpen()) return;
  open = true;
  trackEvent("search_opened", { via });
  emit();
}

export function closeQuickSearch(): void {
  if (!open) return;
  open = false;
  emit();
}

/** The chord: opens the panel, or closes it when it is the one open. */
export function toggleQuickSearch(via: SearchVia): void {
  if (open) closeQuickSearch();
  else openQuickSearch(via);
}

async function read(scope: SearchScope): Promise<SearchIndex> {
  const orgScope = { includeUnscoped: scope.personal };
  const [playlists, folders, reports, drafts, games] = await Promise.all([
    listPlaylistIndex(scope.orgId, orgScope),
    listFolders(scope.orgId, orgScope),
    listMyScoutingReports(),
    listReportDraftTitles(),
    listMatchIndex(scope.orgId),
  ]);
  return buildSearchIndex({ playlists, folders, reports: mergeReportList(reports, drafts, playlists, new Date()), games });
}

/**
 * Reads the scope's index, on every open: five small reads, and the only way
 * a playlist made a moment ago is found. What is held stays on screen
 * meanwhile; a failed read keeps it too, and only an index that was never
 * read turns into an error.
 */
export function refreshSearchIndex(scope: SearchScope): void {
  const key = scopeKey(scope);
  if (held?.key !== key) held = { key, state: LOADING, reading: false };
  const mine = held;
  if (mine.reading) return;
  mine.reading = true;
  if (mine.state.status === "error") mine.state = LOADING;
  emit();
  read(scope)
    .then((index) => {
      mine.state = { status: "ready", index };
    })
    .catch(() => {
      if (mine.state.status !== "ready") mine.state = { status: "error", index: null };
    })
    .finally(() => {
      mine.reading = false;
      // Another space or user took over meanwhile: this read is nobody's.
      if (held === mine) emit();
    });
}

export function useSearchIndex(scope: SearchScope | null): SearchIndexState {
  const key = scope ? scopeKey(scope) : null;
  const get = () => (key && held?.key === key ? held.state : LOADING);
  return useSyncExternalStore(subscribe, get, get);
}
