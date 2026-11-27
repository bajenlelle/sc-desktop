/**
 * The desktop's search over a space (⌘K): which playlists, reports and games
 * a query finds, in what order, and what the panel offers before anything is
 * typed. Pure. The desktop reads a light index (names, folders, dates and
 * statuses; no clips, rosters or plays) and keeps it in memory, so typing
 * never waits for the network (apps/desktop/src/lib/quick-search-store.ts,
 * docs/search.md).
 */
import type { LeagueTeam } from "../types/league-team";
import type { PlaylistFolder } from "../types/match";
import { folderPath } from "./folder-tree";
import { foldForSearch } from "./league-teams";
import type { OpenKind, RecentOpen } from "./recent-opens";
import type { ReportListItem } from "./scouting-report-list";

export type SearchKind = OpenKind;

/** The groups' order: the sidebar's (Playlists, Reports, Library, Teams). */
export const SEARCH_KINDS: readonly SearchKind[] = ["playlist", "report", "game", "team"];

/** How many of a kind a query shows; the group says how many it found. */
export const SEARCH_GROUP_MAX = 5;
/** How many recently opened things the panel offers before a query. */
export const SEARCH_RECENT_MAX = 8;
/** How many of a kind it offers when nothing has been opened here yet. */
export const SEARCH_NEWEST_MAX = 3;

/** As much of a playlist as the search reads. */
export interface SearchPlaylistRow {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: string | null;
  /** "report": a report's own clips, found as the report, not as a playlist. */
  kind?: 'report';
}

/** As much of a game as the search reads. */
export interface SearchGameRow {
  id: string;
  title: string;
  /** The day it was played. */
  date: string | null;
  homeTeam: string;
  awayTeam: string;
  archivedAt: string | null;
  createdAt: string | null;
}

export interface PlaylistSearchItem {
  kind: "playlist";
  id: string;
  title: string;
  /** Its folders from the top down; empty outside every folder. */
  folder: string[];
}

export interface ReportSearchItem {
  kind: "report";
  /** The playlist's id: a playlist has one report. */
  id: string;
  title: string;
  report: ReportListItem;
}

export interface GameSearchItem {
  kind: "game";
  id: string;
  title: string;
  date: string | null;
  archived: boolean;
}

export interface TeamSearchItem {
  kind: "team";
  /** The stable team (league_teams id); /teams/find/:id opens this season's page. */
  id: string;
  title: string;
  /** Its newest league's name, shown to the right. */
  league: string;
}

export type SearchItem = PlaylistSearchItem | ReportSearchItem | GameSearchItem | TeamSearchItem;

export interface SearchGroup {
  kind: SearchKind;
  /** The ones shown, best first. */
  items: SearchItem[];
  /** How many there are of the kind, shown or not. */
  total: number;
}

interface Entry {
  item: SearchItem;
  /** The name, folded (league-teams.ts foldForSearch). */
  name: string;
  /** The name's words. */
  words: string[];
  /** Everything a query may match: the name, then folders, playlist or teams. */
  all: string;
  /** When it is from, for the order of equals: later first. */
  time: number;
  archived: boolean;
}

/** A space's playlists, reports and games, ready to be searched. */
export interface SearchIndex {
  entries: readonly Entry[];
}

const key = (kind: SearchKind, id: string) => `${kind}:${id}`;
const time = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};
const wordsOf = (folded: string) => folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function entry(item: SearchItem, more: string[], when: number, archived = false): Entry {
  const name = foldForSearch(item.title);
  return { item, name, words: wordsOf(name), all: foldForSearch([item.title, ...more].join(" ")), time: when, archived };
}

/**
 * The index of a space. `reports` is the Reports list's own rows
 * (scouting-report-list.ts mergeReportList), so a report is found under the
 * title and with the status that list gives it.
 */
export function buildSearchIndex(source: {
  playlists: readonly SearchPlaylistRow[];
  folders: PlaylistFolder[];
  reports: readonly ReportListItem[];
  games: readonly SearchGameRow[];
  /** This season's teams (the team catalogue); absent until it is read. */
  teams?: readonly LeagueTeam[];
}): SearchIndex {
  const entries: Entry[] = [];
  for (const p of source.playlists) {
    // A report's own clips are found as the report (below), never as a playlist.
    if (p.kind === "report") continue;
    const folder = p.folderId ? folderPath(source.folders, p.folderId) : [];
    entries.push(entry({ kind: "playlist", id: p.id, title: p.name, folder }, folder, time(p.createdAt)));
  }
  for (const r of source.reports) {
    entries.push(entry({ kind: "report", id: r.playlistId, title: r.title, report: r }, r.playlistName === r.title ? [] : [r.playlistName], time(r.changedAt)));
  }
  for (const g of source.games) {
    const archived = !!g.archivedAt;
    entries.push(
      entry({ kind: "game", id: g.id, title: g.title, date: g.date, archived }, [g.homeTeam, g.awayTeam], time(g.date) || time(g.createdAt), archived),
    );
  }
  for (const t of source.teams ?? []) {
    entries.push(entry({ kind: "team", id: t.id, title: t.name, league: t.leagueName }, [t.clubName ?? ""], 0));
  }
  return { entries };
}

/** Whether what is typed is a query yet: something other than spaces. */
export function isSearchQuery(query: string): boolean {
  return foldForSearch(query).length > 0;
}

/**
 * How well an entry answers the words, lower is better; null when a word is
 * missing. 0: the name starts with what was typed. 1: every word starts one
 * of the name's words. 2: every word is in the name. 3: a word is only in the
 * folders, the playlist's name or the teams.
 */
function rank(e: Entry, query: string, words: string[]): number | null {
  if (!words.every((w) => e.all.includes(w))) return null;
  if (e.name.startsWith(query)) return 0;
  if (words.every((w) => e.words.some((n) => n.startsWith(w)))) return 1;
  if (words.every((w) => e.name.includes(w))) return 2;
  return 3;
}

/**
 * What a query finds, grouped by kind in the sidebar's order; a kind with
 * nothing found is left out. In a group: games in the Library before archived
 * ones, then the better match, then what was opened last (`recents`, newest
 * first), then the newest. An empty query finds nothing.
 */
export function searchIndex(index: SearchIndex, query: string, recents: readonly RecentOpen[], perGroup = SEARCH_GROUP_MAX): SearchGroup[] {
  const folded = foldForSearch(query);
  const words = folded.split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const opened = new Map(recents.map((r, i) => [key(r.kind, r.id), i]));
  const found: { e: Entry; rank: number; opened: number }[] = [];
  for (const e of index.entries) {
    const r = rank(e, folded, words);
    if (r !== null) found.push({ e, rank: r, opened: opened.get(key(e.item.kind, e.item.id)) ?? Infinity });
  }
  found.sort(
    (a, b) =>
      Number(a.e.archived) - Number(b.e.archived) ||
      a.rank - b.rank ||
      (a.opened === b.opened ? 0 : a.opened < b.opened ? -1 : 1) ||
      b.e.time - a.e.time ||
      a.e.name.localeCompare(b.e.name),
  );
  return SEARCH_KINDS.flatMap((kind) => {
    const of = found.filter((f) => f.e.item.kind === kind);
    return of.length > 0 ? [{ kind, items: of.slice(0, perGroup).map((f) => f.e.item), total: of.length }] : [];
  });
}

/** What was opened last and is still there, newest first, across kinds. */
export function recentItems(
  index: SearchIndex,
  recents: readonly RecentOpen[],
  max = SEARCH_RECENT_MAX,
  /** Games open on this computer (the sidebar's Open games): they come first, in the order they were opened last. */
  openGames: ReadonlySet<string> = new Set(),
): SearchItem[] {
  const byKey = new Map(index.entries.map((e) => [key(e.item.kind, e.item.id), e.item]));
  const isOpen = (r: RecentOpen) => r.kind === "game" && openGames.has(r.id);
  const out: SearchItem[] = [];
  for (const r of [...recents.filter(isOpen), ...recents.filter((r) => !isOpen(r))]) {
    const item = byKey.get(key(r.kind, r.id));
    if (item) out.push(item);
    if (out.length === max) break;
  }
  return out;
}

/** The newest of each kind, for a computer nothing has been opened on yet. Archived games and teams (a whole league, none newer) are left out. */
export function newestItems(index: SearchIndex, perGroup = SEARCH_NEWEST_MAX): SearchGroup[] {
  return SEARCH_KINDS.filter((kind) => kind !== "team").flatMap((kind) => {
    const of = index.entries.filter((e) => e.item.kind === kind && !e.archived).sort((a, b) => b.time - a.time);
    return of.length > 0 ? [{ kind, items: of.slice(0, perGroup).map((e) => e.item), total: of.length }] : [];
  });
}
