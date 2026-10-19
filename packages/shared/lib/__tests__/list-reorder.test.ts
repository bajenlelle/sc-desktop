import { describe, expect, it } from "vitest";
import {
  dragBlockKeys,
  gapFromPointer,
  isSameOrder,
  itemsIndexForGap,
  layoutAfterInsert,
  layoutAfterMove,
  shiftsFrom,
  type RowRect,
} from "../list-reorder";

// Four rows of 40 px starting at y=10 (a filter bar above them).
const rows: RowRect[] = [10, 50, 90, 130].map((top) => ({ top, height: 40 }));

describe("gapFromPointer", () => {
  it("counts the rows whose midpoint the pointer has passed", () => {
    expect(gapFromPointer(rows, 0)).toBe(0);
    expect(gapFromPointer(rows, 29)).toBe(0);
    expect(gapFromPointer(rows, 31)).toBe(1);
    expect(gapFromPointer(rows, 111)).toBe(3);
    expect(gapFromPointer(rows, 500)).toBe(4);
  });

  it("is 0 for an empty list", () => {
    expect(gapFromPointer([], 100)).toBe(0);
  });
});

describe("dragBlockKeys", () => {
  const order = ["a", "b", "c", "d", "e"];
  const groups = new Map([
    ["b", "g1"],
    ["c", "g1"],
  ]);

  it("is the row alone when it is not part of a multi-selection", () => {
    expect(dragBlockKeys("a", new Set(["d", "e"]), order, groups)).toEqual(["a"]);
    expect(dragBlockKeys("a", new Set(["a"]), order, groups)).toEqual(["a"]);
  });

  it("is the whole selection, in display order, when the row is selected", () => {
    expect(dragBlockKeys("e", new Set(["e", "a"]), order, groups)).toEqual(["a", "e"]);
  });

  it("widens to every member of a touched group", () => {
    expect(dragBlockKeys("b", new Set(), order, groups)).toEqual(["b", "c"]);
    expect(dragBlockKeys("d", new Set(["d", "c"]), order, groups)).toEqual(["b", "c", "d"]);
  });
});

describe("layoutAfterMove", () => {
  it("moves the first row to the end and pulls the others up", () => {
    const layout = layoutAfterMove(rows, [0], 4);
    expect(layout.tops).toEqual([130, 10, 50, 90]);
    expect(layout.blockTop).toBe(130);
    expect(shiftsFrom(rows, layout)).toEqual([120, -40, -40, -40]);
  });

  it("moves the last row to the top and pushes the others down", () => {
    const layout = layoutAfterMove(rows, [3], 0);
    expect(layout.tops).toEqual([50, 90, 130, 10]);
    expect(layout.blockTop).toBe(10);
  });

  it("is a no-op for the gaps on either side of the block", () => {
    expect(shiftsFrom(rows, layoutAfterMove(rows, [1], 1))).toEqual([0, 0, 0, 0]);
    expect(shiftsFrom(rows, layoutAfterMove(rows, [1], 2))).toEqual([0, 0, 0, 0]);
  });

  it("keeps a non-contiguous block together at the landing gap", () => {
    const layout = layoutAfterMove(rows, [0, 2], 4);
    // b, d, then a and c in their old relative order.
    expect(layout.tops).toEqual([90, 10, 130, 50]);
    expect(layout.blockTop).toBe(90);
  });

  it("honours taller rows", () => {
    const mixed: RowRect[] = [
      { top: 0, height: 40 },
      { top: 40, height: 20 },
      { top: 60, height: 40 },
    ];
    const layout = layoutAfterMove(mixed, [2], 0);
    expect(layout.tops).toEqual([40, 80, 0]);
  });
});

describe("layoutAfterInsert", () => {
  it("opens a gap of the inserted height at the gap index", () => {
    const layout = layoutAfterInsert(rows, 2, 36);
    expect(layout.tops).toEqual([10, 50, 126, 166]);
    expect(layout.blockTop).toBe(90);
  });

  it("appends past the end", () => {
    const layout = layoutAfterInsert(rows, 4, 36);
    expect(layout.tops).toEqual([10, 50, 90, 130]);
    expect(layout.blockTop).toBe(170);
  });

  it("lands at 0 in an empty list", () => {
    expect(layoutAfterInsert([], 0, 36)).toEqual({ tops: [], blockTop: 0 });
  });
});

describe("isSameOrder", () => {
  const key = (s: string) => s;
  it("compares by key", () => {
    expect(isSameOrder(["a", "b"], ["a", "b"], key)).toBe(true);
    expect(isSameOrder(["a", "b"], ["b", "a"], key)).toBe(false);
    expect(isSameOrder(["a"], ["a", "b"], key)).toBe(false);
  });
});

describe("itemsIndexForGap", () => {
  const items = ["a", "t1", "b", "c"];
  const display = ["a", "b", "c"];
  it("maps a display gap to the item it opens before", () => {
    expect(itemsIndexForGap(0, display, items)).toBe(0);
    expect(itemsIndexForGap(1, display, items)).toBe(2);
    expect(itemsIndexForGap(2, display, items)).toBe(3);
  });
  it("appends past the end or for an unknown key", () => {
    expect(itemsIndexForGap(3, display, items)).toBe(4);
    expect(itemsIndexForGap(0, ["zzz"], items)).toBe(4);
  });
});
