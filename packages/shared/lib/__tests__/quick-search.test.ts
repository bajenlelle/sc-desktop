import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  isSearchQuery,
  newestItems,
  recentItems,
  searchIndex,
  SEARCH_GROUP_MAX,
  type SearchGameRow,
  type SearchGroup,
  type SearchItem,
  type SearchPlaylistRow,
} from "../quick-search";
import type { RecentOpen } from "../recent-opens";
import type { ReportListItem } from "../scouting-report-list";
import type { PlaylistFolder } from "../../types/match";

const playlist = (id: string, name: string, more: Partial<SearchPlaylistRow> = {}): SearchPlaylistRow => ({
  id,
  name,
  folderId: null,
  createdAt: "2026-10-01T10:00:00Z",
  ...more,
});

const game = (id: string, home: string, away: string, more: Partial<SearchGameRow> = {}): SearchGameRow => ({
  id,
  title: `${home} vs ${away}`,
  date: "2026-10-10",
  homeTeam: home,
  awayTeam: away,
  archivedAt: null,
  createdAt: "2026-10-11T10:00:00Z",
  ...more,
});

const report = (playlistId: string, title: string, more: Partial<ReportListItem> = {}): ReportListItem => ({
  playlistId,
  playlistName: title,
  reportId: null,
  title,
  status: "draft",
  expiresAt: null,
  endedAt: null,
  opens: 0,
  players: 0,
  changedAt: "2026-10-05T10:00:00Z",
  ...more,
});

const folders: PlaylistFolder[] = [
  { id: "f1", name: "Season 25/26", sortOrder: 0 },
  { id: "f2", name: "Scouting", sortOrder: 0, parentId: "f1" },
];

const index = buildSearchIndex({
  playlists: [
    playlist("p1", "Södertälje scouting", { folderId: "f2" }),
    playlist("p2", "PnR defense"),
    playlist("p3", "Transition offense", { folderId: "f1" }),
  ],
  folders,
  reports: [report("p1", "Södertälje BBK", { playlistName: "Södertälje scouting" }), report("p2", "Opponent notes", { playlistName: "PnR defense" })],
  games: [
    game("g1", "Södertälje BBK", "Köping Stars"),
    game("g2", "Norrköping Dolphins", "Södertälje BBK", { date: "2026-11-02" }),
    game("g3", "BC Luleå", "Borås Basket", { title: "Cup final" }),
    game("g4", "Uppsala Basket", "Södertälje BBK", { archivedAt: "2026-11-01T10:00:00Z", date: "2026-11-09" }),
  ],
});

const none: RecentOpen[] = [];
const kinds = (groups: SearchGroup[]) => groups.map((g) => g.kind);
const ids = (items: SearchItem[]) => items.map((i) => i.id);
const group = (groups: SearchGroup[], kind: SearchGroup["kind"]) => groups.find((g) => g.kind === kind);

describe("isSearchQuery", () => {
  it("is false until something other than spaces is typed", () => {
    expect(isSearchQuery("")).toBe(false);
    expect(isSearchQuery("   ")).toBe(false);
    expect(isSearchQuery(" s")).toBe(true);
  });
});

describe("searchIndex", () => {
  it("finds nothing for an empty query", () => {
    expect(searchIndex(index, "  ", none)).toEqual([]);
  });

  it("groups what it finds as playlists, reports, then games: the sidebar's order", () => {
    expect(kinds(searchIndex(index, "söd", none))).toEqual(["playlist", "report", "game"]);
  });

  it("leaves out a kind with nothing found", () => {
    expect(kinds(searchIndex(index, "cup", none))).toEqual(["game"]);
  });

  it("matches without accents and in any case", () => {
    expect(ids(group(searchIndex(index, "sodertalje", none), "playlist")!.items)).toEqual(["p1"]);
    expect(ids(group(searchIndex(index, "SÖDERTÄLJE", none), "playlist")!.items)).toEqual(["p1"]);
  });

  it("wants every word, in any order", () => {
    expect(ids(group(searchIndex(index, "stars söder", none), "game")!.items)).toEqual(["g1"]);
    expect(searchIndex(index, "söder luleå", none)).toEqual([]);
  });

  it("finds a playlist by a folder it is in, and carries the folder's path", () => {
    const found = group(searchIndex(index, "season", none), "playlist")!;
    expect(ids(found.items).sort()).toEqual(["p1", "p3"]);
    expect(found.items.find((i) => i.id === "p1")).toEqual({ kind: "playlist", id: "p1", title: "Södertälje scouting", folder: ["Season 25/26", "Scouting"] });
  });

  it("finds a report by its playlist's name, and carries the report", () => {
    const found = group(searchIndex(index, "pnr", none), "report")!;
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ kind: "report", id: "p2", title: "Opponent notes" });
    expect((found.items[0] as Extract<SearchItem, { kind: "report" }>).report.playlistName).toBe("PnR defense");
  });

  it("finds a game by a team its title doesn't name", () => {
    expect(ids(group(searchIndex(index, "borås", none), "game")!.items)).toEqual(["g3"]);
  });

  it("puts a name that starts with the query before a word that does, before the rest", () => {
    const idx = buildSearchIndex({
      playlists: [playlist("a", "Zone press breaks"), playlist("b", "Press break"), playlist("c", "Full court press"), playlist("d", "Compress the floor")],
      folders: [],
      reports: [],
      games: [],
    });
    // "Press break" starts with it; "Full court press" and "Zone press breaks" have a word that
    // does (equals otherwise, so by name); "Compress the floor" only holds it.
    expect(ids(group(searchIndex(idx, "press", none), "playlist")!.items)).toEqual(["b", "c", "a", "d"]);
  });

  it("puts a match in the name before a match only in the folder or the teams", () => {
    const idx = buildSearchIndex({
      playlists: [playlist("a", "Defense", { folderId: "x" }), playlist("b", "Scouting notes")],
      folders: [{ id: "x", name: "Scouting", sortOrder: 0 }],
      reports: [],
      games: [],
    });
    expect(ids(group(searchIndex(idx, "scouting", none), "playlist")!.items)).toEqual(["b", "a"]);
  });

  it("breaks a tie with what was opened last, then with the newest", () => {
    const idx = buildSearchIndex({
      playlists: [
        playlist("old", "Press one", { createdAt: "2026-09-01T10:00:00Z" }),
        playlist("new", "Press two", { createdAt: "2026-11-01T10:00:00Z" }),
        playlist("mid", "Press three", { createdAt: "2026-10-01T10:00:00Z" }),
      ],
      folders: [],
      reports: [],
      games: [],
    });
    expect(ids(group(searchIndex(idx, "press", none), "playlist")!.items)).toEqual(["new", "mid", "old"]);
    const recents: RecentOpen[] = [
      { kind: "playlist", id: "old", at: 900 },
      { kind: "playlist", id: "mid", at: 800 },
    ];
    expect(ids(group(searchIndex(idx, "press", recents), "playlist")!.items)).toEqual(["old", "mid", "new"]);
  });

  it("lists archived games last, and says they are archived", () => {
    const found = group(searchIndex(index, "södertälje", none), "game")!;
    expect(ids(found.items)).toEqual(["g1", "g2", "g4"]);
    expect(found.items.map((i) => (i.kind === "game" ? i.archived : null))).toEqual([false, false, true]);
  });

  it("shows no more than the limit of a kind, and says how many there are", () => {
    const idx = buildSearchIndex({
      playlists: Array.from({ length: SEARCH_GROUP_MAX + 4 }, (_, i) => playlist(`p${i}`, `Drill ${i}`)),
      folders: [],
      reports: [],
      games: [],
    });
    const found = group(searchIndex(idx, "drill", none), "playlist")!;
    expect(found.items).toHaveLength(SEARCH_GROUP_MAX);
    expect(found.total).toBe(SEARCH_GROUP_MAX + 4);
  });

  it("keeps a playlist and its report apart though they share an id", () => {
    const found = searchIndex(index, "södertälje", none);
    expect(group(found, "playlist")!.items[0]).toMatchObject({ kind: "playlist", id: "p1" });
    expect(group(found, "report")!.items[0]).toMatchObject({ kind: "report", id: "p1" });
  });
});

describe("recentItems", () => {
  it("lists what was opened, last first, across kinds", () => {
    const recents: RecentOpen[] = [
      { kind: "game", id: "g2", at: 300 },
      { kind: "report", id: "p1", at: 200 },
      { kind: "playlist", id: "p2", at: 100 },
    ];
    expect(recentItems(index, recents).map((i) => `${i.kind}:${i.id}`)).toEqual(["game:g2", "report:p1", "playlist:p2"]);
  });

  it("puts the open games first, in the order they were opened last", () => {
    const recents: RecentOpen[] = [
      { kind: "playlist", id: "p2", at: 400 },
      { kind: "game", id: "g1", at: 300 },
      { kind: "game", id: "g2", at: 200 },
      { kind: "game", id: "g3", at: 100 },
    ];
    expect(recentItems(index, recents, 8, new Set(["g3", "g2"])).map((i) => `${i.kind}:${i.id}`)).toEqual([
      "game:g2",
      "game:g3",
      "playlist:p2",
      "game:g1",
    ]);
  });

  it("leaves out what is no longer there", () => {
    const recents: RecentOpen[] = [
      { kind: "playlist", id: "gone", at: 300 },
      { kind: "game", id: "g1", at: 200 },
    ];
    expect(ids(recentItems(index, recents))).toEqual(["g1"]);
  });

  it("stops at the limit it is given", () => {
    const recents: RecentOpen[] = [
      { kind: "game", id: "g1", at: 300 },
      { kind: "game", id: "g2", at: 200 },
      { kind: "game", id: "g3", at: 100 },
    ];
    expect(ids(recentItems(index, recents, 2))).toEqual(["g1", "g2"]);
  });
});

describe("newestItems", () => {
  it("offers the newest of each kind, without archived games", () => {
    const groups = newestItems(index, 2);
    expect(kinds(groups)).toEqual(["playlist", "report", "game"]);
    // g4 is the latest game but archived; g2 (2 Nov) comes before g1 and g3 (10 Oct).
    expect(ids(group(groups, "game")!.items)).toEqual(["g2", "g1"]);
    expect(group(groups, "game")!.total).toBe(3);
  });

  it("is empty for an empty index", () => {
    expect(newestItems(buildSearchIndex({ playlists: [], folders: [], reports: [], games: [] }))).toEqual([]);
  });
});
