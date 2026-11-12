import { describe, expect, it } from "vitest";
import {
  closeGameTab,
  GAME_TABS_MAX,
  NO_GAME_TABS,
  parseGameTabs,
  reconcileGameTabs,
  showGameTab,
  stepGameTab,
  type GameTab,
  type GameTabs,
} from "../game-tabs";

const t = (id: string, title = id.toUpperCase()): GameTab => ({ id, title, date: null });
const st = (ids: string[], recent = [...ids].reverse()): GameTabs => ({ tabs: ids.map((id) => t(id)), recent });
const ids = (s: GameTabs) => s.tabs.map((tab) => tab.id);

describe("showGameTab", () => {
  it("adds a new game at the end and makes it the most recent", () => {
    const s = showGameTab(st(["a", "b"]), t("c"));
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(s.recent).toEqual(["c", "b", "a"]);
  });

  it("showing an open game keeps the strip's order and takes its new title", () => {
    const s = showGameTab(st(["a", "b"]), t("a", "A2"));
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.tabs[0].title).toBe("A2");
    expect(s.recent).toEqual(["a", "b"]);
  });

  it("an empty title never overwrites a known one", () => {
    const s = showGameTab(st(["a", "b"]), { id: "a", title: "", date: null });
    expect(s.tabs[0].title).toBe("A");
  });

  it("at the cap, the game shown least recently makes room", () => {
    const s = showGameTab(st(["a", "b", "c", "d", "e", "f"]), t("g"));
    expect(ids(s)).toEqual(["b", "c", "d", "e", "f", "g"]);
    expect(s.recent).toEqual(["g", "f", "e", "d", "c", "b"]);
  });

  it("returns the same state when nothing changes", () => {
    const s = st(["a", "b"]);
    expect(showGameTab(s, t("b"))).toBe(s);
  });
});

describe("closeGameTab", () => {
  it("closing the shown game moves to the one on its right, else its left", () => {
    expect(closeGameTab(st(["a", "b", "c"], ["b", "a", "c"]), "b").next).toBe("c");
    expect(closeGameTab(st(["a", "b", "c"], ["c", "a", "b"]), "c").next).toBe("b");
  });

  it("closing another game keeps the shown one", () => {
    const { state, next } = closeGameTab(st(["a", "b", "c"], ["a", "b", "c"]), "c");
    expect(next).toBeNull();
    expect(ids(state)).toEqual(["a", "b"]);
  });

  it("closing the last game leaves none", () => {
    expect(closeGameTab(st(["a"]), "a")).toEqual({ state: NO_GAME_TABS, next: null });
  });
});

describe("stepGameTab", () => {
  it("steps in strip order and wraps", () => {
    const s = st(["a", "b", "c"]);
    expect(stepGameTab(s, "b", 1)).toBe("c");
    expect(stepGameTab(s, "c", 1)).toBe("a");
    expect(stepGameTab(s, "a", -1)).toBe("c");
  });

  it("has nowhere to go with one tab or an unknown game", () => {
    expect(stepGameTab(st(["a"]), "a", 1)).toBeNull();
    expect(stepGameTab(st(["a", "b"]), "z", 1)).toBeNull();
  });
});

describe("reconcileGameTabs", () => {
  it("drops games that are gone and takes renamed titles", () => {
    const s = reconcileGameTabs(
      st(["a", "b", "c"]),
      [
        { id: "a", title: "A2", date: null },
        { id: "c", title: "C", date: null },
      ],
      null,
    );
    expect(ids(s)).toEqual(["a", "c"]);
    expect(s.tabs.map((tab) => tab.title)).toEqual(["A2", "C"]);
    expect(s.recent).toEqual(["c", "a"]);
  });

  it("drops a game that moved to another space", () => {
    const s = reconcileGameTabs(
      st(["a", "b"]),
      [
        { id: "a", title: "A", date: null },
        { id: "b", title: "B", date: null, orgId: "o2" },
      ],
      "o1",
    );
    expect(ids(s)).toEqual(["a"]);
    expect(s.recent).toEqual(["a"]);
  });

  it("keeps everything when nothing came back (a failed read)", () => {
    const s = st(["a", "b"]);
    expect(reconcileGameTabs(s, [], "o1")).toBe(s);
  });
});

describe("parseGameTabs", () => {
  it("reads nothing from nothing or from garbage", () => {
    expect(parseGameTabs(null)).toEqual(NO_GAME_TABS);
    expect(parseGameTabs("{bad")).toEqual(NO_GAME_TABS);
  });

  it("round-trips what it wrote", () => {
    const s = st(["a", "b"]);
    expect(parseGameTabs(JSON.stringify(s))).toEqual(s);
  });

  it("drops entries without an id, keeps duplicates once, and repairs recent", () => {
    const raw = JSON.stringify({
      tabs: [{ id: "a", title: "A", date: null }, { title: "no id" }, { id: 3 }, { id: "b", title: "B", date: null }, { id: "a", title: "A again", date: null }, { id: "c", title: "C", date: "2026-11-01" }],
      recent: ["b", "x", "b"],
    });
    const s = parseGameTabs(raw);
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(s.tabs[0].title).toBe("A");
    expect(s.tabs[2].date).toBe("2026-11-01");
    // Only ids that have tabs; the ones missing are appended in strip order.
    expect(s.recent).toEqual(["b", "a", "c"]);
  });

  it("keeps the most recent max tabs when there are more", () => {
    const s = parseGameTabs(JSON.stringify(st(["a", "b", "c", "d"], ["c", "a", "d", "b"])), 2);
    expect(ids(s)).toEqual(["a", "c"]);
    expect(s.recent).toEqual(["c", "a"]);
    expect(GAME_TABS_MAX).toBe(6);
  });
});
