import { describe, expect, it } from "vitest";
import {
  clickSelection,
  extendSelection,
  focusAfterRemoval,
  moveFocus,
  pruneSelection,
  rangeKeys,
} from "../list-selection";

const order = ["a", "b", "c", "d", "e", "f"];
const sorted = (s: Iterable<string>) => [...s].sort();

describe("moveFocus", () => {
  it("moves by rows and stops at the ends", () => {
    expect(moveFocus(order, "c", 1)).toBe("d");
    expect(moveFocus(order, "c", -1)).toBe("b");
    expect(moveFocus(order, "f", 1)).toBe("f");
    expect(moveFocus(order, "a", -1)).toBe("a");
    expect(moveFocus(order, "b", 10)).toBe("f");
  });

  it("jumps to the first or last row", () => {
    expect(moveFocus(order, "c", "first")).toBe("a");
    expect(moveFocus(order, "c", "last")).toBe("f");
    expect(moveFocus(order, null, "last")).toBe("f");
  });

  it("starts at the top going down and at the bottom going up", () => {
    expect(moveFocus(order, null, 1)).toBe("a");
    expect(moveFocus(order, null, -1)).toBe("f");
    expect(moveFocus(order, "gone", 1)).toBe("a");
    expect(moveFocus(order, "gone", -1)).toBe("f");
  });

  it("has nowhere to go in an empty list", () => {
    expect(moveFocus([], "a", 1)).toBeNull();
    expect(moveFocus([], null, "first")).toBeNull();
  });
});

describe("rangeKeys", () => {
  it("spans anchor to focus in list order, either direction", () => {
    expect(rangeKeys(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeKeys(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeKeys(order, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the focus alone without an anchor in the list", () => {
    expect(rangeKeys(order, null, "c")).toEqual(["c"]);
    expect(rangeKeys(order, "gone", "c")).toEqual(["c"]);
    expect(rangeKeys(order, "a", "gone")).toEqual([]);
  });
});

describe("extendSelection", () => {
  it("grows from the anchor with Shift+Down from nothing selected", () => {
    const one = extendSelection({ order, selected: new Set(), anchor: "b", previousFocus: "b", focus: "c" });
    expect(sorted(one)).toEqual(["b", "c"]);
    const two = extendSelection({ order, selected: one, anchor: "b", previousFocus: "c", focus: "d" });
    expect(sorted(two)).toEqual(["b", "c", "d"]);
  });

  it("shrinks when the focus moves back toward the anchor", () => {
    const grown = new Set(["b", "c", "d"]);
    const back = extendSelection({ order, selected: grown, anchor: "b", previousFocus: "d", focus: "c" });
    expect(sorted(back)).toEqual(["b", "c"]);
  });

  it("flips across the anchor", () => {
    const grown = new Set(["c", "d"]);
    const flipped = extendSelection({ order, selected: grown, anchor: "c", previousFocus: "d", focus: "a" });
    expect(sorted(flipped)).toEqual(["a", "b", "c"]);
  });

  it("keeps rows selected outside the range", () => {
    const selected = new Set(["f", "b"]);
    const next = extendSelection({ order, selected, anchor: "b", previousFocus: "b", focus: "c" });
    expect(sorted(next)).toEqual(["b", "c", "f"]);
  });

  it("leaves the input set alone", () => {
    const selected = new Set(["a"]);
    extendSelection({ order, selected, anchor: "a", previousFocus: "a", focus: "c" });
    expect(sorted(selected)).toEqual(["a"]);
  });
});

describe("clickSelection", () => {
  const base = { order, shift: false, toggle: false };

  it("lets go of the selection on a plain click on a row outside it, moving focus and anchor there", () => {
    const r = clickSelection({ ...base, selected: new Set(["a", "b"]), anchor: "a", focus: "b", key: "d" });
    expect(sorted(r.selected)).toEqual([]);
    expect(r.anchor).toBe("d");
    expect(r.focus).toBe("d");
  });

  it("keeps the selection on a plain click on a row inside it, so the picked rows can be watched one by one", () => {
    const selected = new Set(["a", "c"]);
    const r = clickSelection({ ...base, selected, anchor: "a", focus: "a", key: "c" });
    expect(sorted(r.selected)).toEqual(["a", "c"]);
    expect(r.anchor).toBe("c");
    expect(r.focus).toBe("c");
  });

  it("leaves an empty selection empty on a plain click", () => {
    expect(sorted(clickSelection({ ...base, selected: new Set<string>(), anchor: null, focus: null, key: "c" }).selected)).toEqual([]);
  });

  it("toggles a row with ⌘ and anchors there", () => {
    const on = clickSelection({ ...base, toggle: true, selected: new Set(["a"]), anchor: "a", focus: "a", key: "d" });
    expect(sorted(on.selected)).toEqual(["a", "d"]);
    expect(on.anchor).toBe("d");
    const off = clickSelection({ ...base, toggle: true, selected: on.selected, anchor: "d", focus: "d", key: "a" });
    expect(sorted(off.selected)).toEqual(["d"]);
  });

  it("selects the range from the anchor with Shift, keeping the anchor", () => {
    const r = clickSelection({ ...base, shift: true, selected: new Set(), anchor: "b", focus: "b", key: "e" });
    expect(sorted(r.selected)).toEqual(["b", "c", "d", "e"]);
    expect(r.anchor).toBe("b");
    expect(r.focus).toBe("e");
    // A second Shift-click replaces the range rather than adding to it.
    const again = clickSelection({ ...base, shift: true, selected: r.selected, anchor: r.anchor, focus: r.focus, key: "c" });
    expect(sorted(again.selected)).toEqual(["b", "c"]);
  });

  it("adds a Shift range to rows picked with ⌘ (Finder)", () => {
    const picked = clickSelection({ ...base, toggle: true, selected: new Set(["a"]), anchor: "a", focus: "a", key: "d" });
    const r = clickSelection({ ...base, shift: true, ...picked, key: "f" });
    expect(sorted(r.selected)).toEqual(["a", "d", "e", "f"]);
  });

  it("treats a Shift-click without an anchor as picking that row", () => {
    const r = clickSelection({ ...base, shift: true, selected: new Set(), anchor: null, focus: null, key: "c" });
    expect(sorted(r.selected)).toEqual(["c"]);
    expect(r.anchor).toBe("c");
    const stale = clickSelection({ ...base, shift: true, selected: new Set(), anchor: "gone", focus: "gone", key: "c" });
    expect(sorted(stale.selected)).toEqual(["c"]);
  });
});

describe("pruneSelection", () => {
  it("drops rows that are no longer shown", () => {
    expect(sorted(pruneSelection(new Set(["a", "x", "c"]), order))).toEqual(["a", "c"]);
  });

  it("hands back the same set when nothing was dropped", () => {
    const selected = new Set(["a", "c"]);
    expect(pruneSelection(selected, order)).toBe(selected);
    const empty = new Set<string>();
    expect(pruneSelection(empty, [])).toBe(empty);
  });
});

describe("focusAfterRemoval", () => {
  it("moves to the row that took the removed row's place", () => {
    expect(focusAfterRemoval(order, new Set(["c"]), "c")).toBe("d");
    expect(focusAfterRemoval(order, new Set(["c", "d"]), "c")).toBe("e");
  });

  it("moves up from the last row", () => {
    expect(focusAfterRemoval(order, new Set(["f"]), "f")).toBe("e");
    expect(focusAfterRemoval(order, new Set(["e", "f"]), "e")).toBe("d");
  });

  it("keeps a focus that survived, and has nothing left when all go", () => {
    expect(focusAfterRemoval(order, new Set(["a"]), "c")).toBe("c");
    expect(focusAfterRemoval(["a"], new Set(["a"]), "a")).toBeNull();
    expect(focusAfterRemoval(order, new Set(), null)).toBeNull();
  });
});
