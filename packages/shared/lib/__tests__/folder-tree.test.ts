import { describe, expect, it } from "vitest";
import type { PlaylistFolder } from "../../types/match";
import {
  ancestorIds,
  buildDescendantMap,
  buildFolderTree,
  childFoldersByParent,
  collectSubtreeIds,
  compareFolders,
  flattenFolderTree,
  folderPath,
  isDescendantOf,
  subtreeStats,
  wouldCreateCycle,
  wouldCreateCycleWith,
} from "../folder-tree";

const f = (id: string, parentId?: string, extra?: Partial<PlaylistFolder>): PlaylistFolder => ({
  id,
  name: id,
  sortOrder: 0,
  parentId,
  ...extra,
});

const ids = (list: PlaylistFolder[]) => list.map((x) => x.id);

/** a <-> b mutual parents (unreachable from any root), plus a normal root. */
const cycleFixture = () => [f("root"), f("a", "b"), f("b", "a")];

/** root > mid > leaf chain. */
const chain = () => [f("root"), f("mid", "root"), f("leaf", "mid")];

describe("compareFolders", () => {
  it("sorts by sortOrder ascending first, regardless of name", () => {
    const early = f("z", undefined, { name: "zzz", sortOrder: 1 });
    const late = f("a", undefined, { name: "aaa", sortOrder: 2 });
    expect(compareFolders(early, late)).toBeLessThan(0);
    expect(compareFolders(late, early)).toBeGreaterThan(0);
  });

  it("breaks sortOrder ties by name, case-insensitively", () => {
    const apple = f("1", undefined, { name: "apple" });
    const banana = f("2", undefined, { name: "Banana" });
    expect(compareFolders(apple, banana)).toBeLessThan(0);
    expect(compareFolders(banana, apple)).toBeGreaterThan(0);
  });

  it("compares names with the Swedish locale (å after z)", () => {
    const zebra = f("1", undefined, { name: "zebra" });
    const angen = f("2", undefined, { name: "ängen" });
    // sv collation puts å/ä/ö after z; an en-locale compare would invert this
    expect(compareFolders(zebra, angen)).toBeLessThan(0);
  });

  it("falls back to id when names are equal ignoring case", () => {
    const a = f("a", undefined, { name: "Same" });
    const b = f("b", undefined, { name: "same" });
    expect(compareFolders(a, b)).toBeLessThan(0);
    expect(compareFolders(b, a)).toBeGreaterThan(0);
  });
});

describe("childFoldersByParent", () => {
  it("puts a flat list under the null key, sorted", () => {
    const map = childFoldersByParent([f("b"), f("c"), f("a")]);
    expect([...map.keys()]).toEqual([null]);
    expect(ids(map.get(null)!)).toEqual(["a", "b", "c"]);
  });

  it("groups nested folders under their parent id, sorted", () => {
    const map = childFoldersByParent([
      f("p"),
      f("c2", "p", { sortOrder: 1 }),
      f("c1", "p", { sortOrder: 0 }),
    ]);
    expect(ids(map.get(null)!)).toEqual(["p"]);
    expect(ids(map.get("p")!)).toEqual(["c1", "c2"]);
  });

  it("surfaces an orphan (parentId not in the set) as a root", () => {
    const map = childFoldersByParent([f("root"), f("orphan", "ghost")]);
    expect(ids(map.get(null)!)).toEqual(["orphan", "root"]);
    expect(map.get("ghost")).toBeUndefined();
  });

  it("keeps children of an orphan attached to the orphan", () => {
    const map = childFoldersByParent([f("orphan", "ghost"), f("kid", "orphan")]);
    expect(ids(map.get(null)!)).toEqual(["orphan"]);
    expect(ids(map.get("orphan")!)).toEqual(["kid"]);
  });

  it("surfaces both members of an a<->b cycle as roots so nothing disappears", () => {
    const map = childFoldersByParent(cycleFixture());
    expect(ids(map.get(null)!)).toEqual(["a", "b", "root"]);
    expect(map.get("a")).toBeUndefined();
    expect(map.get("b")).toBeUndefined();
  });

  it("also surfaces a child of a cycle member as a root", () => {
    // "kid" has a valid parentId ("a"), but a is a cycle member so kid is
    // unreachable from any root — it is re-rooted to null rather than kept
    // under the (also re-rooted) cycle member a. Everything stays visible,
    // though kid is detached from its parent in the rendered tree.
    const map = childFoldersByParent([...cycleFixture(), f("kid", "a")]);
    expect(ids(map.get(null)!)).toEqual(["a", "b", "kid", "root"]);
    expect(map.get("a")).toBeUndefined();
  });
});

describe("buildFolderTree", () => {
  it("builds an a > b > c chain with depths 0/1/2 and nested children", () => {
    const tree = buildFolderTree([f("a"), f("b", "a"), f("c", "b")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].folder.id).toBe("a");
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].folder.id).toBe("b");
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].folder.id).toBe("c");
    expect(tree[0].children[0].children[0].depth).toBe(2);
    expect(tree[0].children[0].children[0].children).toEqual([]);
  });

  it("sorts multiple roots", () => {
    const tree = buildFolderTree([
      f("r2", undefined, { sortOrder: 1 }),
      f("r1", undefined, { sortOrder: 0 }),
      f("r3", undefined, { sortOrder: 2 }),
    ]);
    expect(tree.map((n) => n.folder.id)).toEqual(["r1", "r2", "r3"]);
    expect(tree.map((n) => n.depth)).toEqual([0, 0, 0]);
  });
});

describe("flattenFolderTree", () => {
  it("walks pre-order: parent before children, siblings in sorted order", () => {
    const flat = flattenFolderTree([
      f("root"),
      f("b", "root", { sortOrder: 1 }),
      f("a", "root", { sortOrder: 0 }),
      f("a1", "a"),
    ]);
    expect(flat.map((e) => e.folder.id)).toEqual(["root", "a", "a1", "b"]);
    expect(flat.map((e) => e.depth)).toEqual([0, 1, 2, 1]);
  });
});

describe("collectSubtreeIds", () => {
  it("returns just the folder itself for a leaf", () => {
    expect(collectSubtreeIds(chain(), "leaf")).toEqual(new Set(["leaf"]));
  });

  it("collects all five ids of a 5-deep chain from its root", () => {
    const folders = [f("f1"), f("f2", "f1"), f("f3", "f2"), f("f4", "f3"), f("f5", "f4")];
    expect(collectSubtreeIds(folders, "f1")).toEqual(new Set(["f1", "f2", "f3", "f4", "f5"]));
  });

  it("does not include a sibling branch", () => {
    const folders = [f("root"), f("a", "root"), f("b", "a"), f("sib", "root")];
    expect(collectSubtreeIds(folders, "a")).toEqual(new Set(["a", "b"]));
  });

  it("returns {rootId} for an unknown rootId", () => {
    expect(collectSubtreeIds(chain(), "nope")).toEqual(new Set(["nope"]));
  });
});

describe("isDescendantOf", () => {
  it("is true for a direct child", () => {
    expect(isDescendantOf(chain(), "mid", "root")).toBe(true);
  });

  it("is true for a deep descendant", () => {
    expect(isDescendantOf(chain(), "leaf", "root")).toBe(true);
  });

  it("is false for itself (strict descent)", () => {
    expect(isDescendantOf(chain(), "root", "root")).toBe(false);
  });

  it("is false for an ancestor", () => {
    expect(isDescendantOf(chain(), "root", "leaf")).toBe(false);
  });

  it("is false for an unrelated folder", () => {
    expect(isDescendantOf([...chain(), f("x")], "x", "root")).toBe(false);
  });

  it("terminates on a parent cycle and returns false", () => {
    expect(isDescendantOf(cycleFixture(), "a", "root")).toBe(false);
  });
});

describe("wouldCreateCycle", () => {
  it("is true when moving a folder onto itself", () => {
    expect(wouldCreateCycle(chain(), "root", "root")).toBe(true);
  });

  it("is true when moving a folder onto its own child", () => {
    expect(wouldCreateCycle(chain(), "root", "mid")).toBe(true);
  });

  it("is true when moving a folder onto its own grandchild", () => {
    expect(wouldCreateCycle(chain(), "root", "leaf")).toBe(true);
  });

  it("is false when moving a folder onto its sibling", () => {
    const folders = [f("root"), f("a", "root"), f("sib", "root")];
    expect(wouldCreateCycle(folders, "a", "sib")).toBe(false);
  });

  it("is false when moving a folder onto its own ancestor", () => {
    expect(wouldCreateCycle(chain(), "leaf", "root")).toBe(false);
  });

  it("is false when moving a folder to the root (null)", () => {
    expect(wouldCreateCycle(chain(), "leaf", null)).toBe(false);
  });
});

describe("subtreeStats", () => {
  const folders = [...chain(), f("other")];
  const playlists = [
    { folderId: "root" },
    { folderId: "mid" },
    { folderId: "leaf" },
    { folderId: "other" },
    {}, // uncategorized
  ];

  it("counts descendants excluding the root, and playlists across the subtree", () => {
    expect(subtreeStats(folders, playlists, "root")).toEqual({
      folderCount: 2,
      playlistCount: 3,
    });
  });

  it("ignores playlists in other folders and uncategorized ones", () => {
    expect(subtreeStats(folders, playlists, "other")).toEqual({
      folderCount: 0,
      playlistCount: 1,
    });
  });

  it("reports zero subfolders for a leaf", () => {
    expect(subtreeStats(folders, playlists, "leaf")).toEqual({
      folderCount: 0,
      playlistCount: 1,
    });
  });
});

describe("folderPath", () => {
  it("returns names from the root ancestor down to the folder", () => {
    expect(folderPath(chain(), "leaf")).toEqual(["root", "mid", "leaf"]);
  });

  it("starts the path at an orphan when its parentId dangles", () => {
    const folders = [f("orphan", "ghost"), f("kid", "orphan")];
    expect(folderPath(folders, "kid")).toEqual(["orphan", "kid"]);
  });

  it("returns [] for a missing id", () => {
    expect(folderPath(chain(), "nope")).toEqual([]);
  });

  it("terminates on a parent cycle, listing each member once", () => {
    expect(folderPath(cycleFixture(), "a")).toEqual(["b", "a"]);
  });
});

describe("ancestorIds", () => {
  it("returns ancestors nearest-first", () => {
    expect(ancestorIds(chain(), "leaf")).toEqual(["mid", "root"]);
  });

  it("returns [] for a root folder", () => {
    expect(ancestorIds(chain(), "root")).toEqual([]);
  });

  it("returns [] for an unknown id", () => {
    expect(ancestorIds(chain(), "nope")).toEqual([]);
  });

  it("terminates on a mutual a<->b cycle", () => {
    expect(ancestorIds(cycleFixture(), "a")).toEqual(["b"]);
  });

  // Suspected quirk: the parentId is pushed before checking that the parent
  // folder exists, so a dangling parentId shows up in the ancestor list even
  // though no such folder is in the set (folderPath, by contrast, drops it).
  it("includes a dangling parentId that points at no known folder", () => {
    expect(ancestorIds([f("orphan", "ghost")], "orphan")).toEqual(["ghost"]);
  });
});

describe("buildDescendantMap", () => {
  it("maps each folder to its strict descendants down a chain", () => {
    const map = buildDescendantMap(chain());
    expect([...(map.get("root") ?? [])].sort()).toEqual(["leaf", "mid"]);
    expect([...(map.get("mid") ?? [])]).toEqual(["leaf"]);
    expect(map.get("leaf")).toBeUndefined();
  });

  it("never lists a folder as its own descendant, even inside a cycle", () => {
    const map = buildDescendantMap(cycleFixture());
    expect(map.get("a")?.has("a")).toBe(false);
    expect(map.get("b")?.has("b")).toBe(false);
    // a and b are mutually descended, matching isDescendantOf
    expect(map.get("a")?.has("b")).toBe(true);
    expect(map.get("b")?.has("a")).toBe(true);
  });

  it("keys a dangling parentId even though no such folder exists", () => {
    // Mirrors ancestorIds: the walk climbs into the ghost id before
    // discovering it is unknown, so the ghost gains a descendant entry.
    const map = buildDescendantMap([f("orphan", "ghost")]);
    expect([...(map.get("ghost") ?? [])]).toEqual(["orphan"]);
  });

  it("returns an empty map for an empty list", () => {
    expect(buildDescendantMap([]).size).toBe(0);
  });
});

describe("wouldCreateCycleWith", () => {
  // The whole point of the prebuilt map is to be a drop-in for the O(F)
  // version, so pin them together across every shape this module documents.
  const fixtures: Array<[string, PlaylistFolder[]]> = [
    ["chain", chain()],
    ["cycle", cycleFixture()],
    ["orphan", [f("orphan", "ghost"), f("root")]],
    ["flat", [f("a"), f("b"), f("c")]],
    ["deep", [f("r"), f("x", "r"), f("y", "x"), f("z", "y")]],
    ["empty", []],
  ];

  for (const [label, folders] of fixtures) {
    it(`agrees with wouldCreateCycle for every id pair (${label})`, () => {
      const map = buildDescendantMap(folders);
      const candidates: Array<string | null> = [null, ...ids(folders), "ghost", "unknown"];
      for (const folderId of [...ids(folders), "unknown"]) {
        for (const target of candidates) {
          expect(wouldCreateCycleWith(map, folderId, target)).toBe(
            wouldCreateCycle(folders, folderId, target),
          );
        }
      }
    });
  }

  it("allows the root target and refuses self", () => {
    const map = buildDescendantMap(chain());
    expect(wouldCreateCycleWith(map, "mid", null)).toBe(false);
    expect(wouldCreateCycleWith(map, "mid", "mid")).toBe(true);
  });

  it("refuses moving a folder into its own subtree but allows the reverse", () => {
    const map = buildDescendantMap(chain());
    expect(wouldCreateCycleWith(map, "root", "leaf")).toBe(true);
    expect(wouldCreateCycleWith(map, "leaf", "root")).toBe(false);
  });
});
