import { describe, expect, it } from "vitest";
import { LIST_OVERSCAN, listWindow, scrollTopToReveal } from "../list-window";

describe("listWindow", () => {
  it("draws nothing for an empty list", () => {
    expect(listWindow({ count: 0, rowHeight: 45, scrollTop: 0, viewportHeight: 600 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("draws the rows in view plus the overscan either side", () => {
    expect(listWindow({ count: 1000, rowHeight: 45, scrollTop: 4500, viewportHeight: 600 })).toEqual({
      start: 92,
      end: 122,
      padTop: 4140,
      padBottom: 39510,
    });
  });

  it("stops at the top and at the bottom", () => {
    const top = listWindow({ count: 1000, rowHeight: 45, scrollTop: 0, viewportHeight: 600 });
    expect(top.start).toBe(0);
    expect(top.padTop).toBe(0);
    const bottom = listWindow({ count: 1000, rowHeight: 45, scrollTop: 44400, viewportHeight: 600 });
    expect(bottom.end).toBe(1000);
    expect(bottom.padBottom).toBe(0);
  });

  it("a scroll offset past the end, after the list got shorter, draws the last rows", () => {
    const w = listWindow({ count: 20, rowHeight: 45, scrollTop: 10000, viewportHeight: 600 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(20);
    expect(w.padBottom).toBe(0);
  });

  it("before the view is measured it draws the first rows", () => {
    const w = listWindow({ count: 1000, rowHeight: 45, scrollTop: 0, viewportHeight: 0 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(LIST_OVERSCAN);
    expect(w.end).toBe(8);
  });

  it("draws a whole list that is shorter than the view", () => {
    expect(listWindow({ count: 5, rowHeight: 45, scrollTop: 0, viewportHeight: 600 })).toEqual({
      start: 0,
      end: 5,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("takes the overscan it is given", () => {
    const w = listWindow({ count: 1000, rowHeight: 45, scrollTop: 4500, viewportHeight: 600, overscan: 2 });
    expect(w.start).toBe(98);
    expect(w.end).toBe(116);
  });

  it("draws nothing for a row height that is not positive", () => {
    const empty = { start: 0, end: 0, padTop: 0, padBottom: 0 };
    expect(listWindow({ count: 100, rowHeight: 0, scrollTop: 0, viewportHeight: 600 })).toEqual(empty);
    expect(listWindow({ count: 100, rowHeight: -45, scrollTop: 0, viewportHeight: 600 })).toEqual(empty);
  });

  it("the space above, the rows and the space below add up to the whole list", () => {
    const inputs = [
      { count: 1000, rowHeight: 45, scrollTop: 4500, viewportHeight: 600 },
      { count: 1000, rowHeight: 45, scrollTop: 4517, viewportHeight: 613 },
      { count: 1000, rowHeight: 45, scrollTop: 44400, viewportHeight: 600 },
      { count: 20, rowHeight: 45, scrollTop: 10000, viewportHeight: 600 },
      { count: 7, rowHeight: 52, scrollTop: 0, viewportHeight: 0 },
    ];
    for (const o of inputs) {
      const w = listWindow(o);
      expect(w.padTop + (w.end - w.start) * o.rowHeight + w.padBottom).toBe(o.count * o.rowHeight);
    }
  });
});

describe("scrollTopToReveal", () => {
  it("null when the row is in view", () => {
    expect(scrollTopToReveal({ index: 5, rowHeight: 45, scrollTop: 0, viewportHeight: 600 })).toBeNull();
  });

  it("a row above the view comes to the top", () => {
    expect(scrollTopToReveal({ index: 10, rowHeight: 45, scrollTop: 900, viewportHeight: 600 })).toBe(450);
  });

  it("a row below the view comes to the bottom", () => {
    expect(scrollTopToReveal({ index: 30, rowHeight: 45, scrollTop: 0, viewportHeight: 600 })).toBe(795);
  });

  it("a row half out of view counts as out", () => {
    expect(scrollTopToReveal({ index: 13, rowHeight: 45, scrollTop: 0, viewportHeight: 600 })).toBe(30);
  });

  it("a row taller than the view comes to the top", () => {
    expect(scrollTopToReveal({ index: 3, rowHeight: 100, scrollTop: 0, viewportHeight: 60 })).toBe(300);
    expect(scrollTopToReveal({ index: 3, rowHeight: 100, scrollTop: 900, viewportHeight: 60 })).toBe(300);
    expect(scrollTopToReveal({ index: 3, rowHeight: 100, scrollTop: 300, viewportHeight: 60 })).toBeNull();
  });
});
