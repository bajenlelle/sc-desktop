import { describe, expect, it } from "vitest";
import type { PlaylistClipItem } from "../../types/match";
import {
  computeGroupRuns,
  moveBlock,
  normalizeGroups,
  snapGapToGroupBoundary,
} from "../clip-groups";

interface Item {
  k: string;
}

const items = (...ks: string[]): Item[] => ks.map((k) => ({ k }));
const keyOf = (i: Item) => i.k;
const keys = (list: Item[]) => list.map((i) => i.k);
const groups = (entries: [string, string][]) => new Map(entries);

describe("moveBlock", () => {
  it("counts the gap in the original list, forward and backward", () => {
    const list = items("a", "b", "c", "d", "e");
    // forward: gap 4 sits between d and e in the ORIGINAL list
    expect(keys(moveBlock(list, [1], 4))).toEqual(["a", "c", "d", "b", "e"]);
    // backward: gap 1 sits between a and b in the original list
    expect(keys(moveBlock(list, [3], 1))).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("lands a non-contiguous block contiguously in original relative order", () => {
    const list = items("a", "b", "c", "d", "e");
    expect(keys(moveBlock(list, [0, 2], 5))).toEqual(["b", "d", "e", "a", "c"]);
  });

  it("handles the list edges", () => {
    const list = items("a", "b", "c", "d", "e");
    expect(keys(moveBlock(list, [2], 0))).toEqual(["c", "a", "b", "d", "e"]);
    expect(keys(moveBlock(list, [0], 5))).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("is a no-op when the gap falls inside the moved block", () => {
    const list = items("a", "b", "c", "d");
    expect(keys(moveBlock(list, [1, 2], 2))).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the original list", () => {
    const list = items("a", "b", "c");
    moveBlock(list, [0], 3);
    expect(keys(list)).toEqual(["a", "b", "c"]);
  });
});

describe("snapGapToGroupBoundary", () => {
  const list = items("x", "p", "q", "r", "y");
  const g = groups([
    ["p", "G"],
    ["q", "G"],
    ["r", "G"],
  ]);
  const none = new Set<string>();

  it("snaps a gap inside a foreign run to its nearest boundary", () => {
    expect(snapGapToGroupBoundary(2, list, keyOf, g, none)).toBe(1); // closer to start
    expect(snapGapToGroupBoundary(3, list, keyOf, g, none)).toBe(4); // closer to end
  });

  it("snaps after the run on an equidistant tie", () => {
    const pair = items("x", "p", "q", "y");
    const g2 = groups([
      ["p", "G"],
      ["q", "G"],
    ]);
    expect(snapGapToGroupBoundary(2, pair, keyOf, g2, none)).toBe(3);
  });

  it("leaves gaps at run edges unchanged", () => {
    expect(snapGapToGroupBoundary(1, list, keyOf, g, none)).toBe(1);
    expect(snapGapToGroupBoundary(4, list, keyOf, g, none)).toBe(4);
  });

  it("leaves a gap between two different groups unchanged", () => {
    const two = items("p", "q", "r", "s");
    const g2 = groups([
      ["p", "A"],
      ["q", "A"],
      ["r", "B"],
      ["s", "B"],
    ]);
    expect(snapGapToGroupBoundary(2, two, keyOf, g2, none)).toBe(2);
  });

  it("leaves a gap unchanged when the item after it is being dragged", () => {
    expect(snapGapToGroupBoundary(2, list, keyOf, g, new Set(["q"]))).toBe(2);
  });

  it("leaves out-of-range gaps unchanged", () => {
    expect(snapGapToGroupBoundary(0, list, keyOf, g, none)).toBe(0);
    expect(snapGapToGroupBoundary(5, list, keyOf, g, none)).toBe(5);
    expect(snapGapToGroupBoundary(9, list, keyOf, g, none)).toBe(9);
  });
});

describe("computeGroupRuns", () => {
  it("labels first/middle/last across a run", () => {
    const list = items("p", "q", "r");
    const runs = computeGroupRuns(
      list,
      keyOf,
      groups([
        ["p", "G"],
        ["q", "G"],
        ["r", "G"],
      ]),
    );
    expect(runs.get("p")).toEqual({ groupId: "G", pos: "first", size: 3 });
    expect(runs.get("q")).toEqual({ groupId: "G", pos: "middle", size: 3 });
    expect(runs.get("r")).toEqual({ groupId: "G", pos: "last", size: 3 });
  });

  it("labels a lone member as only", () => {
    const runs = computeGroupRuns(items("x", "p", "y"), keyOf, groups([["p", "G"]]));
    expect(runs.get("p")).toEqual({ groupId: "G", pos: "only", size: 1 });
  });

  it("treats separated runs of the same group as separate runs", () => {
    const list = items("p", "q", "x", "r", "s");
    const runs = computeGroupRuns(
      list,
      keyOf,
      groups([
        ["p", "G"],
        ["q", "G"],
        ["r", "G"],
        ["s", "G"],
      ]),
    );
    expect(runs.get("p")).toEqual({ groupId: "G", pos: "first", size: 2 });
    expect(runs.get("q")).toEqual({ groupId: "G", pos: "last", size: 2 });
    expect(runs.get("r")).toEqual({ groupId: "G", pos: "first", size: 2 });
    expect(runs.get("s")).toEqual({ groupId: "G", pos: "last", size: 2 });
    expect(runs.has("x")).toBe(false);
  });

  it("is empty when nothing is grouped", () => {
    expect(computeGroupRuns(items("a", "b"), keyOf, new Map()).size).toBe(0);
  });
});

describe("normalizeGroups", () => {
  const c = (eventId: number, groupId?: string): PlaylistClipItem => ({
    type: "clip",
    matchId: "m",
    eventId,
    ...(groupId ? { groupId } : {}),
  });

  it("dissolves single-member groups by removing the key entirely", () => {
    const [solo] = normalizeGroups([c(1, "g1")]);
    expect("groupId" in solo).toBe(false);
  });

  it("keeps groups with two or more members", () => {
    const out = normalizeGroups([c(1, "g1"), c(2, "g1"), c(3, "g2")]);
    expect(out[0].groupId).toBe("g1");
    expect(out[1].groupId).toBe("g1");
    expect("groupId" in out[2]).toBe(false);
  });

  it("passes ungrouped items through unchanged", () => {
    const plain = c(1);
    expect(normalizeGroups([plain])[0]).toBe(plain);
  });
});
