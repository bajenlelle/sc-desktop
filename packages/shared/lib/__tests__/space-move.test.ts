import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  autoGameIds,
  buildMoveTree,
  clearGames,
  clearPlaylists,
  countNoun,
  duplicateLabel,
  folderCheckState,
  isEverythingSelected,
  moveConfirmBody,
  moveConfirmNotes,
  moveConfirmTitle,
  moveErrorMessage,
  moveItemsLabel,
  moveResultLabel,
  movingGameIds,
  selectAll,
  selectAllGames,
  selectAllPlaylists,
  summarizeSelection,
  toRequest,
  toggleFolder,
  toggleGame,
  togglePlaylist,
  type MoveSummary,
  type MoveTree,
  type MoveTreeNode,
} from "../space-move";
import type {
  MoveDuplicate,
  MoveErrorToken,
  MoveFolder,
  MoveGame,
  MovePlaylist,
  MovePreview,
  MoveResult,
  MoveSelection,
} from "../../types/space-move";

const folder = (id: string, name: string, parentId: string | null, sortOrder = 0): MoveFolder => ({
  id,
  name,
  parentId,
  sortOrder,
});

const playlist = (
  id: string,
  folderId: string | null,
  matchIds: string[],
  extra?: Partial<MovePlaylist>,
): MovePlaylist => ({
  id,
  name: id,
  folderId,
  createdAt: "2026-10-01T10:00:00Z",
  clipCount: matchIds.length,
  matchIds,
  demoClipCount: 0,
  otherSpaceClipCount: 0,
  shared: false,
  ...extra,
});

const game = (id: string, duplicate: MoveDuplicate | null = null): MoveGame => ({
  id,
  title: id,
  gameDate: null,
  home: null,
  away: null,
  createdAt: "2026-09-30T18:00:00Z",
  duplicate,
});

/**
 * Outer (root) > Inner, plus an empty root folder. Folders are listed out of
 * order: Empty has sortOrder 1, so it sorts after Outer even though "Empty" < "Outer".
 *   Outer: L4 []        Inner: L1 [GA], L2 [GB] (shared)       unfiled: L3 [GA]
 *   GB is already in the club and mergeable; GC is there but plays differ.
 */
const preview: MovePreview = {
  personalOrgId: "personal",
  target: { orgId: "club", name: "AIK", planTier: "pro", licenseState: "active" },
  folders: [folder("empty", "Empty", null, 1), folder("inner", "Inner", "outer"), folder("outer", "Outer", null, 0)],
  playlists: [
    playlist("L1", "inner", ["GA"]),
    playlist("L2", "inner", ["GB"], { shared: true }),
    playlist("L3", null, ["GA"]),
    playlist("L4", "outer", []),
  ],
  games: [
    game("GA"),
    game("GB", { clubMatchId: "club-GB", mergeable: true, reason: null }),
    game("GC", { clubMatchId: "club-GC", mergeable: false, reason: "plays_differ" }),
  ],
};

const tree = buildMoveTree(preview);

const previewWith = (partial: Partial<MovePreview>): MovePreview => ({ ...preview, ...partial });

const sorted = (s: ReadonlySet<string>) => [...s].sort();

/** Tree as plain ids, for whole-shape assertions. */
const shape = (n: MoveTreeNode): unknown => ({
  id: n.folder.id,
  depth: n.depth,
  playlists: n.playlists.map((p) => p.id),
  children: n.children.map(shape),
});

/** Ticks playlists one at a time, the way the picker does. */
const pick = (...playlistIds: string[]): MoveSelection =>
  playlistIds.reduce((s, id) => togglePlaylist(tree, s, id), EMPTY_SELECTION);

const states = (t: MoveTree, s: MoveSelection) => ({
  outer: folderCheckState(t, s, "outer"),
  inner: folderCheckState(t, s, "inner"),
  empty: folderCheckState(t, s, "empty"),
});

const zeroSummary: MoveSummary = {
  games: 0,
  playlists: 0,
  folders: 0,
  autoGames: 0,
  merges: 0,
  secondCopies: 0,
  stayingPlaylists: 0,
  sharedPlaylists: 0,
};

describe("buildMoveTree", () => {
  it("nests folders with depths, puts playlists under their folder, and lists unfiled ones", () => {
    expect(tree.roots.map(shape)).toEqual([
      {
        id: "outer",
        depth: 0,
        playlists: ["L4"],
        children: [{ id: "inner", depth: 1, playlists: ["L1", "L2"], children: [] }],
      },
      { id: "empty", depth: 0, playlists: [], children: [] },
    ]);
    expect(tree.unfiled.map((p) => p.id)).toEqual(["L3"]);
  });

  it("orders siblings by sortOrder, then by name case-insensitively", () => {
    const t = buildMoveTree(
      previewWith({
        folders: [folder("b", "beta", null, 0), folder("a", "Alpha", null, 0), folder("c", "Zulu", null, -1)],
        playlists: [],
      }),
    );
    expect(t.roots.map((n) => n.folder.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts playlists by name case-insensitively", () => {
    const t = buildMoveTree(
      previewWith({
        folders: [],
        playlists: [
          playlist("p1", null, [], { name: "b" }),
          playlist("p2", null, [], { name: "A" }),
          playlist("p3", null, [], { name: "c" }),
        ],
      }),
    );
    expect(t.unfiled.map((p) => p.name)).toEqual(["A", "b", "c"]);
  });

  it("makes a folder whose parent isn't listed a root", () => {
    const t = buildMoveTree(previewWith({ folders: [folder("x", "X", "gone")], playlists: [] }));
    expect(t.roots.map(shape)).toEqual([{ id: "x", depth: 0, playlists: [], children: [] }]);
  });

  it("makes folders in a parent cycle roots instead of dropping them", () => {
    const t = buildMoveTree(
      previewWith({
        folders: [folder("root", "root", null), folder("a", "a", "b"), folder("b", "b", "a")],
        playlists: [],
      }),
    );
    expect(t.roots.map(shape)).toEqual([
      { id: "a", depth: 0, playlists: [], children: [] },
      { id: "b", depth: 0, playlists: [], children: [] },
      { id: "root", depth: 0, playlists: [], children: [] },
    ]);
  });

  it("puts a playlist whose folder isn't listed under unfiled", () => {
    const t = buildMoveTree(previewWith({ playlists: [playlist("P", "gone", [])] }));
    expect(t.unfiled.map((p) => p.id)).toEqual(["P"]);
    expect(t.roots.flatMap((n) => n.playlists)).toEqual([]);
  });

  it("is empty for an empty preview", () => {
    expect(buildMoveTree(previewWith({ folders: [], playlists: [], games: [] }))).toEqual({
      roots: [],
      unfiled: [],
    });
  });
});

describe("toggleFolder / togglePlaylist / folderCheckState", () => {
  it("ticking a folder ticks its whole subtree and every playlist in it", () => {
    const s = toggleFolder(tree, EMPTY_SELECTION, "outer");
    expect(sorted(s.folderIds)).toEqual(["inner", "outer"]);
    expect(sorted(s.playlistIds)).toEqual(["L1", "L2", "L4"]);
    expect(sorted(s.gameIds)).toEqual([]);
    expect(states(tree, s)).toEqual({ outer: "checked", inner: "checked", empty: "unchecked" });
  });

  it("ticking a folder again unticks its subtree", () => {
    const s = toggleFolder(tree, toggleFolder(tree, EMPTY_SELECTION, "outer"), "outer");
    expect(sorted(s.folderIds)).toEqual([]);
    expect(sorted(s.playlistIds)).toEqual([]);
  });

  it("unticking one playlist makes its ancestors mixed and drops them from folderIds", () => {
    const s = togglePlaylist(tree, toggleFolder(tree, EMPTY_SELECTION, "outer"), "L1");
    expect(sorted(s.folderIds)).toEqual([]);
    expect(sorted(s.playlistIds)).toEqual(["L2", "L4"]);
    expect(states(tree, s)).toEqual({ outer: "mixed", inner: "mixed", empty: "unchecked" });
  });

  it("unticking a ticked subfolder leaves the parent mixed", () => {
    const s = toggleFolder(tree, toggleFolder(tree, EMPTY_SELECTION, "outer"), "inner");
    expect(sorted(s.folderIds)).toEqual([]);
    expect(sorted(s.playlistIds)).toEqual(["L4"]);
    expect(states(tree, s)).toEqual({ outer: "mixed", inner: "unchecked", empty: "unchecked" });
  });

  it("ticking every playlist in a folder checks the folder (auto-promote), bottom-up", () => {
    const s1 = pick("L1");
    expect(sorted(s1.folderIds)).toEqual([]);
    expect(states(tree, s1)).toEqual({ outer: "mixed", inner: "mixed", empty: "unchecked" });

    const s2 = togglePlaylist(tree, s1, "L2");
    expect(sorted(s2.folderIds)).toEqual(["inner"]);
    expect(states(tree, s2)).toEqual({ outer: "mixed", inner: "checked", empty: "unchecked" });

    const s3 = togglePlaylist(tree, s2, "L4");
    expect(sorted(s3.folderIds)).toEqual(["inner", "outer"]);
    expect(states(tree, s3)).toEqual({ outer: "checked", inner: "checked", empty: "unchecked" });
  });

  it("checks an empty folder only when it is toggled itself", () => {
    const all = pick("L1", "L2", "L3", "L4");
    expect(folderCheckState(tree, all, "empty")).toBe("unchecked");
    expect(all.folderIds.has("empty")).toBe(false);

    const on = toggleFolder(tree, all, "empty");
    expect(folderCheckState(tree, on, "empty")).toBe("checked");
    expect(sorted(on.folderIds)).toEqual(["empty", "inner", "outer"]);

    const off = toggleFolder(tree, on, "empty");
    expect(folderCheckState(tree, off, "empty")).toBe("unchecked");
  });

  it("an empty subfolder doesn't stop its parent counting as ticked, and comes along", () => {
    const p = previewWith({
      folders: [folder("p", "P", null), folder("e", "E", "p")],
      playlists: [playlist("X", "p", [])],
    });
    const t = buildMoveTree(p);
    const s = togglePlaylist(t, EMPTY_SELECTION, "X");
    expect(sorted(s.folderIds)).toEqual(["e", "p"]);
    expect(folderCheckState(t, s, "p")).toBe("checked");
    expect(folderCheckState(t, s, "e")).toBe("checked");
    expect(toRequest(t, p, s).folderIds).toEqual(["p"]);

    // It moves with its parent, so it can't be left behind on its own.
    const s2 = toggleFolder(t, s, "e");
    expect(sorted(s2.folderIds)).toEqual(["e", "p"]);

    const s3 = togglePlaylist(t, s, "X");
    expect(sorted(s3.folderIds)).toEqual([]);
  });

  it("toggling a mixed folder selects all of it", () => {
    const mixed = pick("L1");
    expect(folderCheckState(tree, mixed, "outer")).toBe("mixed");
    const s = toggleFolder(tree, mixed, "outer");
    expect(sorted(s.folderIds)).toEqual(["inner", "outer"]);
    expect(sorted(s.playlistIds)).toEqual(["L1", "L2", "L4"]);
  });

  it("keeps the ticked games when folders and playlists toggle", () => {
    const s = toggleFolder(tree, toggleGame(EMPTY_SELECTION, "GC"), "outer");
    expect(sorted(s.gameIds)).toEqual(["GC"]);
    expect(sorted(togglePlaylist(tree, s, "L1").gameIds)).toEqual(["GC"]);
  });

  it("returns the selection unchanged for an unknown folder, which reads as unchecked", () => {
    const s = pick("L1");
    expect(toggleFolder(tree, s, "nope")).toBe(s);
    expect(folderCheckState(tree, s, "nope")).toBe("unchecked");
  });

  it("never mutates the selection it is given", () => {
    const before = pick("L1");
    toggleFolder(tree, before, "outer");
    togglePlaylist(tree, before, "L3");
    toggleGame(before, "GC");
    expect(sorted(before.playlistIds)).toEqual(["L1"]);
    expect(sorted(before.folderIds)).toEqual([]);
    expect(sorted(before.gameIds)).toEqual([]);
    expect(EMPTY_SELECTION.playlistIds.size + EMPTY_SELECTION.folderIds.size + EMPTY_SELECTION.gameIds.size).toBe(0);
  });
});

describe("toggleGame", () => {
  it("adds and removes one game, leaving folders and playlists alone", () => {
    const base = pick("L1");
    const on = toggleGame(base, "GC");
    expect(sorted(on.gameIds)).toEqual(["GC"]);
    expect(on.playlistIds).toBe(base.playlistIds);
    expect(sorted(toggleGame(on, "GC").gameIds)).toEqual([]);
  });
});

describe("bulk selection helpers", () => {
  it("selectAll ticks every folder, playlist and game in the preview", () => {
    const s = selectAll(preview);
    expect(sorted(s.folderIds)).toEqual(["empty", "inner", "outer"]);
    expect(sorted(s.playlistIds)).toEqual(["L1", "L2", "L3", "L4"]);
    expect(sorted(s.gameIds)).toEqual(["GA", "GB", "GC"]);
  });

  it("selectAllPlaylists ticks every playlist and folder (the empty one too) and keeps the games", () => {
    const s = selectAllPlaylists(tree, preview, toggleGame(EMPTY_SELECTION, "GC"));
    expect(sorted(s.folderIds)).toEqual(["empty", "inner", "outer"]);
    expect(sorted(s.playlistIds)).toEqual(["L1", "L2", "L3", "L4"]);
    expect(sorted(s.gameIds)).toEqual(["GC"]);
  });

  it("clearPlaylists drops folders and playlists, keeping games", () => {
    const s = clearPlaylists(selectAll(preview));
    expect(sorted(s.folderIds)).toEqual([]);
    expect(sorted(s.playlistIds)).toEqual([]);
    expect(sorted(s.gameIds)).toEqual(["GA", "GB", "GC"]);
  });

  it("selectAllGames ticks every game, keeping playlists", () => {
    const s = selectAllGames(preview, pick("L1"));
    expect(sorted(s.gameIds)).toEqual(["GA", "GB", "GC"]);
    expect(sorted(s.playlistIds)).toEqual(["L1"]);
  });

  it("clearGames drops games, keeping folders and playlists", () => {
    const s = clearGames(selectAll(preview));
    expect(sorted(s.gameIds)).toEqual([]);
    expect(sorted(s.folderIds)).toEqual(["empty", "inner", "outer"]);
    expect(sorted(s.playlistIds)).toEqual(["L1", "L2", "L3", "L4"]);
  });
});

describe("autoGameIds / movingGameIds", () => {
  it("brings the games a ticked playlist's clips use", () => {
    expect(sorted(autoGameIds(preview, pick("L1")))).toEqual(["GA"]);
    expect(sorted(autoGameIds(preview, pick("L1", "L2")))).toEqual(["GA", "GB"]);
    expect(sorted(autoGameIds(preview, pick("L4")))).toEqual([]);
  });

  it("brings nothing for ticked games alone or unticked playlists", () => {
    expect(sorted(autoGameIds(preview, toggleGame(EMPTY_SELECTION, "GC")))).toEqual([]);
    expect(sorted(autoGameIds(preview, EMPTY_SELECTION))).toEqual([]);
  });

  it("ignores game ids the preview doesn't list (e.g. the demo game)", () => {
    const p = previewWith({ playlists: [playlist("L4", "outer", ["demo", "GC"])] });
    expect(sorted(autoGameIds(p, togglePlaylist(buildMoveTree(p), EMPTY_SELECTION, "L4")))).toEqual(["GC"]);
  });

  it("movingGameIds is the ticked games plus the auto ones, each once", () => {
    expect(sorted(movingGameIds(preview, toggleGame(pick("L1"), "GC")))).toEqual(["GA", "GC"]);
    expect(sorted(movingGameIds(preview, toggleGame(pick("L1"), "GA")))).toEqual(["GA"]);
  });
});

describe("isEverythingSelected", () => {
  it("is true after selectAll and false for nothing", () => {
    expect(isEverythingSelected(preview, selectAll(preview))).toBe(true);
    expect(isEverythingSelected(preview, EMPTY_SELECTION)).toBe(false);
  });

  it("counts auto games: all playlists plus the one game no playlist uses is everything", () => {
    const allPlaylists = selectAllPlaylists(tree, preview, EMPTY_SELECTION);
    expect(isEverythingSelected(preview, allPlaylists)).toBe(false);
    expect(isEverythingSelected(preview, toggleGame(allPlaylists, "GC"))).toBe(true);
  });

  it("is false while the empty folder is unticked", () => {
    const s = toggleGame(pick("L1", "L2", "L3", "L4"), "GC");
    expect(isEverythingSelected(preview, s)).toBe(false);
    expect(isEverythingSelected(preview, toggleFolder(tree, s, "empty"))).toBe(true);
  });
});

describe("toRequest", () => {
  it("sends a fully ticked folder as its top id, unfiled playlists by id, and only non-auto games", () => {
    let s = toggleFolder(tree, EMPTY_SELECTION, "outer");
    s = togglePlaylist(tree, s, "L3");
    s = toggleGame(s, "GA"); // also brought by L1 and L3
    s = toggleGame(s, "GC");
    expect(toRequest(tree, preview, s)).toEqual({ matchIds: ["GC"], playlistIds: ["L3"], folderIds: ["outer"] });
  });

  it("sends playlist ids and no folder id for a partially ticked folder", () => {
    expect(toRequest(tree, preview, pick("L1", "L4"))).toEqual({
      matchIds: [],
      playlistIds: ["L1", "L4"],
      folderIds: [],
    });
  });

  it("sends a fully ticked subfolder of a partial parent as its own folder id", () => {
    expect(toRequest(tree, preview, pick("L1", "L2"))).toEqual({
      matchIds: [],
      playlistIds: [],
      folderIds: ["inner"],
    });
  });

  it("sends a ticked empty folder", () => {
    expect(toRequest(tree, preview, toggleFolder(tree, EMPTY_SELECTION, "empty"))).toEqual({
      matchIds: [],
      playlistIds: [],
      folderIds: ["empty"],
    });
  });

  it("reduces selectAll to the root folders, the unfiled playlist and the game no playlist uses", () => {
    expect(toRequest(tree, preview, selectAll(preview))).toEqual({
      matchIds: ["GC"],
      playlistIds: ["L3"],
      folderIds: ["outer", "empty"],
    });
  });

  it("sends games in preview order and drops ones the preview doesn't list", () => {
    let s = toggleGame(EMPTY_SELECTION, "GC");
    s = toggleGame(s, "ghost");
    s = toggleGame(s, "GA");
    expect(toRequest(tree, preview, s).matchIds).toEqual(["GA", "GC"]);
  });

  it("derives non-empty folders from their ticked playlists, not from folderIds alone", () => {
    const handBuilt: MoveSelection = { folderIds: new Set(["outer"]), playlistIds: new Set(), gameIds: new Set() };
    expect(toRequest(tree, preview, handBuilt)).toEqual({ matchIds: [], playlistIds: [], folderIds: [] });
  });
});

describe("summarizeSelection", () => {
  it("is all zeros for nothing ticked", () => {
    expect(summarizeSelection(tree, preview, EMPTY_SELECTION)).toEqual(zeroSummary);
  });

  it("counts an unticked playlist that uses a moving game as staying (tick L1 → L3 stays, uses GA)", () => {
    expect(summarizeSelection(tree, preview, pick("L1"))).toEqual({
      ...zeroSummary,
      games: 1,
      playlists: 1,
      autoGames: 1,
      stayingPlaylists: 1,
    });
  });

  it("counts a mergeable duplicate as a merge and old sharing on a ticked playlist", () => {
    expect(summarizeSelection(tree, preview, pick("L2"))).toEqual({
      ...zeroSummary,
      games: 1,
      playlists: 1,
      autoGames: 1,
      merges: 1,
      sharedPlaylists: 1,
    });
  });

  it("counts a non-mergeable duplicate as a second copy", () => {
    expect(summarizeSelection(tree, preview, toggleGame(EMPTY_SELECTION, "GC"))).toEqual({
      ...zeroSummary,
      games: 1,
      secondCopies: 1,
    });
  });

  it("counts every unticked playlist using a game that is ticked on its own", () => {
    expect(summarizeSelection(tree, preview, toggleGame(EMPTY_SELECTION, "GA")).stayingPlaylists).toBe(2);
  });

  it("counts nested full folders, not just the roots the request sends", () => {
    expect(summarizeSelection(tree, preview, toggleFolder(tree, EMPTY_SELECTION, "outer")).folders).toBe(2);
  });

  it("summarises selectAll", () => {
    expect(summarizeSelection(tree, preview, selectAll(preview))).toEqual({
      games: 3,
      playlists: 4,
      folders: 3,
      autoGames: 2,
      merges: 1,
      secondCopies: 1,
      stayingPlaylists: 0,
      sharedPlaylists: 1,
    });
  });
});

describe("countNoun", () => {
  it("uses the singular only for exactly 1", () => {
    expect(countNoun(1, "game", "games")).toBe("1 game");
    expect(countNoun(0, "game", "games")).toBe("0 games");
    expect(countNoun(2, "game", "games")).toBe("2 games");
  });
});

describe("moveItemsLabel", () => {
  it("joins games and playlists, pluralising each", () => {
    expect(moveItemsLabel(3, 2)).toBe("3 games and 2 playlists");
    expect(moveItemsLabel(1, 1)).toBe("1 game and 1 playlist");
  });

  it("leaves out a zero part", () => {
    expect(moveItemsLabel(1, 0)).toBe("1 game");
    expect(moveItemsLabel(0, 2)).toBe("2 playlists");
  });

  it("says Nothing selected for zero of both", () => {
    expect(moveItemsLabel(0, 0)).toBe("Nothing selected");
  });

  it("names folders only when nothing else moves", () => {
    expect(moveItemsLabel(0, 0, 1)).toBe("1 folder");
    expect(moveItemsLabel(0, 0, 2)).toBe("2 folders");
    expect(moveItemsLabel(1, 2, 3)).toBe("1 game and 2 playlists");
  });
});

describe("moveConfirmTitle / moveConfirmBody", () => {
  it("names what moves and the club", () => {
    expect(moveConfirmTitle(summarizeSelection(tree, preview, pick("L1")), "AIK")).toBe(
      "Move 1 game and 1 playlist to AIK?",
    );
    expect(moveConfirmTitle(summarizeSelection(tree, preview, selectAll(preview)), "AIK")).toBe(
      "Move 3 games and 4 playlists to AIK?",
    );
  });

  it("names the folder when only an empty folder is ticked", () => {
    const s = toggleFolder(tree, EMPTY_SELECTION, "empty");
    expect(moveConfirmTitle(summarizeSelection(tree, preview, s), "AIK")).toBe("Move 1 folder to AIK?");
  });

  it("explains what moving means, naming the club twice", () => {
    expect(moveConfirmBody("AIK")).toBe(
      "They leave your personal space. In AIK, only you see them until you share a playlist. You can't move them back, and if you leave AIK they stay there.",
    );
  });
});

describe("moveConfirmNotes", () => {
  it("is empty when nothing applies, whatever the item counts", () => {
    expect(moveConfirmNotes({ ...zeroSummary, games: 3, playlists: 2, folders: 1, autoGames: 2 }, "AIK")).toEqual([]);
  });

  it("notes merges, singular and plural", () => {
    expect(moveConfirmNotes({ ...zeroSummary, merges: 1 }, "AIK")).toEqual([
      "1 game is already in AIK. Your clips join that copy.",
    ]);
    expect(moveConfirmNotes({ ...zeroSummary, merges: 2 }, "AIK")).toEqual([
      "2 games are already in AIK. Your clips join those copies.",
    ]);
  });

  it("notes second copies, singular and plural", () => {
    expect(moveConfirmNotes({ ...zeroSummary, secondCopies: 1 }, "AIK")).toEqual([
      "1 game is also in AIK but can't be merged, so AIK gets a second copy.",
    ]);
    expect(moveConfirmNotes({ ...zeroSummary, secondCopies: 3 }, "AIK")).toEqual([
      "3 games are also in AIK but can't be merged, so AIK gets second copies.",
    ]);
  });

  it("notes staying playlists, singular and plural", () => {
    expect(moveConfirmNotes({ ...zeroSummary, stayingPlaylists: 1 }, "AIK")).toEqual([
      "1 playlist that stays in your personal space uses these games. It keeps its clips.",
    ]);
    expect(moveConfirmNotes({ ...zeroSummary, stayingPlaylists: 2 }, "AIK")).toEqual([
      "2 playlists that stay in your personal space use these games. They keep their clips.",
    ]);
  });

  it("notes removed sharing, singular and plural", () => {
    expect(moveConfirmNotes({ ...zeroSummary, sharedPlaylists: 1 }, "AIK")).toEqual([
      "Old sharing on 1 playlist is removed.",
    ]);
    expect(moveConfirmNotes({ ...zeroSummary, sharedPlaylists: 2 }, "AIK")).toEqual([
      "Old sharing on 2 playlists is removed.",
    ]);
  });

  it("orders the lines merges, second copies, staying playlists, sharing", () => {
    const s = summarizeSelection(tree, preview, toggleGame(pick("L1", "L2"), "GC"));
    expect(moveConfirmNotes(s, "AIK")).toEqual([
      "1 game is already in AIK. Your clips join that copy.",
      "1 game is also in AIK but can't be merged, so AIK gets a second copy.",
      "1 playlist that stays in your personal space uses these games. It keeps its clips.",
      "Old sharing on 1 playlist is removed.",
    ]);
  });
});

describe("duplicateLabel", () => {
  it("says will be merged, with no detail, for a mergeable copy", () => {
    expect(duplicateLabel({ clubMatchId: "c1", mergeable: true, reason: null }, "AIK")).toEqual({
      label: "Already in AIK · Will be merged",
      detail: null,
    });
  });

  it("ignores the reason when the copy is mergeable", () => {
    expect(duplicateLabel({ clubMatchId: "c1", mergeable: true, reason: "plays_differ" }, "AIK").detail).toBeNull();
  });

  it.each([
    ["plays_differ", "The plays differ between the two copies"],
    ["video_differs", "The copies use different video or sync"],
    ["stats_source_differs", "The copies take their plays from different sources"],
  ] as const)("explains %s as a second copy", (reason, detail) => {
    expect(duplicateLabel({ clubMatchId: "c1", mergeable: false, reason }, "AIK")).toEqual({
      label: "Already in AIK · Moves as a second copy",
      detail,
    });
  });

  it("has no detail for a second copy without a reason", () => {
    expect(duplicateLabel({ clubMatchId: "c1", mergeable: false, reason: null }, "AIK")).toEqual({
      label: "Already in AIK · Moves as a second copy",
      detail: null,
    });
  });
});

describe("moveErrorMessage", () => {
  it("names the club for license and role errors", () => {
    expect(moveErrorMessage("license_locked", "AIK")).toBe(
      "AIK's license has expired. Renew it to move content there.",
    );
    expect(moveErrorMessage("not_staff", "AIK")).toBe("Only coaches and admins of AIK can move content there.");
  });

  it.each<MoveErrorToken>(["not_movable", "demo_not_movable", "folder_has_other_space_content"])(
    "asks for a reload on %s",
    (token) => {
      expect(moveErrorMessage(token, "AIK")).toBe("Some items changed since the list loaded. Reload it and try again.");
    },
  );

  it("explains too_many and nothing_to_move", () => {
    expect(moveErrorMessage("too_many", "AIK")).toBe("Too many items for one move. Move them in smaller batches.");
    expect(moveErrorMessage("nothing_to_move", "AIK")).toBe("Select at least one game or playlist.");
  });

  it.each<MoveErrorToken>(["not_authenticated", "target_not_club", "no_personal_space", "merge_incomplete", "unknown"])(
    "falls back to the generic message on %s",
    (token) => {
      expect(moveErrorMessage(token, "AIK")).toBe("Content couldn't be moved. Nothing was changed.");
    },
  );
});

describe("moveResultLabel", () => {
  const result = (partial: Partial<MoveResult>): MoveResult => ({
    moveId: "mv1",
    gamesMoved: 0,
    gamesMerged: 0,
    gamesKeptSeparate: 0,
    playlistsMoved: 0,
    foldersCreated: 0,
    foldersReused: 0,
    foldersRemoved: 0,
    labelsCreated: 0,
    labelAssignmentsMoved: 0,
    clipsRepointed: 0,
    sharesRemoved: 0,
    merged: [],
    separate: [],
    ...partial,
  });

  it("counts merged games as moved; kept-separate ones are already inside gamesMoved", () => {
    // The server puts second copies in v_move, so games_moved includes them.
    expect(moveResultLabel(result({ gamesMoved: 2, gamesMerged: 1, gamesKeptSeparate: 1, playlistsMoved: 2 }))).toBe(
      "3 games and 2 playlists",
    );
  });

  it("is singular for one merged game and nothing else", () => {
    expect(moveResultLabel(result({ gamesMerged: 1 }))).toBe("1 game");
  });

  it("names the folders after a folder-only move", () => {
    expect(moveResultLabel(result({ foldersCreated: 1, foldersRemoved: 1 }))).toBe("1 folder");
  });
});
