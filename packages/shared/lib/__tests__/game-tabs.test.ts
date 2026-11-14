import { describe, expect, it } from "vitest";
import {
  closedGameTabs,
  closeGameTab,
  closeOtherGameTabs,
  GAME_TABS_MAX,
  gameTabForKey,
  NO_GAME_TABS,
  orderGameTabs,
  parseGameTabs,
  reconcileGameTabs,
  reopenGameTab,
  showGameTab,
  stepGameTab,
  tabTitleParts,
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

describe("orderGameTabs", () => {
  it("puts the tabs in the order they were dragged into", () => {
    const s = orderGameTabs(st(["a", "b", "c"]), ["c", "a", "b"]);
    expect(ids(s)).toEqual(["c", "a", "b"]);
  });

  it("leaves which game was shown last as it was", () => {
    const s = orderGameTabs(st(["a", "b", "c"], ["b", "c", "a"]), ["c", "b", "a"]);
    expect(s.recent).toEqual(["b", "c", "a"]);
  });

  it("keeps each tab's own title and date", () => {
    const s = orderGameTabs({ tabs: [t("a", "First"), t("b", "Second")], recent: ["a", "b"] }, ["b", "a"]);
    expect(s.tabs).toEqual([t("b", "Second"), t("a", "First")]);
  });

  it("ignores a game that has no tab", () => {
    expect(ids(orderGameTabs(st(["a", "b"]), ["x", "b", "a"]))).toEqual(["b", "a"]);
  });

  it("keeps a tab the new order doesn't name, after the ones it does", () => {
    // Opened while the drag was under way.
    expect(ids(orderGameTabs(st(["a", "b", "c"]), ["b", "a"]))).toEqual(["b", "a", "c"]);
  });

  it("returns the same state when the order is the one it has", () => {
    const state = st(["a", "b", "c"]);
    expect(orderGameTabs(state, ["a", "b", "c"])).toBe(state);
  });
});

describe("closedGameTabs", () => {
  it("names the tabs a change closed, each with the place it stood in", () => {
    const before = st(["a", "b", "c"]);
    const { state } = closeGameTab(before, "b");
    expect(closedGameTabs(before, state)).toEqual([{ tab: t("b"), index: 1 }]);
  });

  it("names the tab that made room for a seventh game", () => {
    const before = st(["a", "b", "c", "d", "e", "f"]);
    expect(closedGameTabs(before, showGameTab(before, t("g")))).toEqual([{ tab: t("a"), index: 0 }]);
  });

  it("places several closed tabs so that reopening them, the last first, puts each back where it stood", () => {
    // As if they had been closed one after the other from the left: a place counts only the tabs still there.
    for (const kept of ["a", "b", "c", "d"]) {
      const before = st(["a", "b", "c", "d"]);
      const after = closeOtherGameTabs(before, kept);
      let s = after;
      for (const closed of closedGameTabs(before, after).reverse()) s = reopenGameTab(s, closed);
      expect(ids(s), `with ${kept} kept`).toEqual(["a", "b", "c", "d"]);
    }
    const before = st(["a", "b", "c"]);
    expect(closedGameTabs(before, closeOtherGameTabs(before, "c"))).toEqual([
      { tab: t("a"), index: 0 },
      { tab: t("b"), index: 0 },
    ]);
  });

  it("names nothing when no tab went", () => {
    const before = st(["a", "b"]);
    expect(closedGameTabs(before, showGameTab(before, t("c")))).toEqual([]);
    expect(closedGameTabs(before, orderGameTabs(before, ["b", "a"]))).toEqual([]);
  });
});

describe("reopenGameTab", () => {
  it("puts a closed tab back where it stood and shows it", () => {
    const s = reopenGameTab(st(["a", "c"]), { tab: t("b"), index: 1 });
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(s.recent[0]).toBe("b");
  });

  it("puts it at the end when the strip has grown shorter than its old place", () => {
    expect(ids(reopenGameTab(st(["a"]), { tab: t("d"), index: 3 }))).toEqual(["a", "d"]);
  });

  it("only shows a game that has been opened again meanwhile", () => {
    const s = reopenGameTab(st(["a", "b"], ["a", "b"]), { tab: t("b"), index: 0 });
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.recent).toEqual(["b", "a"]);
  });

  it("at the cap, the game shown least recently makes room, never the one put back", () => {
    const full = st(["a", "b", "c", "d", "e", "f"]);
    const s = reopenGameTab(full, { tab: t("z"), index: 0 });
    expect(ids(s)).toEqual(["z", "b", "c", "d", "e", "f"]);
    expect(s.recent).toEqual(["z", "f", "e", "d", "c", "b"]);
    expect(s.tabs).toHaveLength(GAME_TABS_MAX);
  });
});

describe("closeOtherGameTabs", () => {
  it("leaves the one tab", () => {
    const s = closeOtherGameTabs(st(["a", "b", "c"]), "b");
    expect(ids(s)).toEqual(["b"]);
    expect(s.recent).toEqual(["b"]);
  });

  it("changes nothing when there is no other tab, or the tab isn't open", () => {
    const one = st(["a"]);
    expect(closeOtherGameTabs(one, "a")).toBe(one);
    const two = st(["a", "b"]);
    expect(closeOtherGameTabs(two, "x")).toBe(two);
  });
});

describe("gameTabForKey", () => {
  const strip = ["a", "b", "c"];

  it("moves to the tab on the right and on the left", () => {
    expect(gameTabForKey(strip, "a", "ArrowRight")).toBe("b");
    expect(gameTabForKey(strip, "b", "ArrowLeft")).toBe("a");
  });

  it("wraps at both ends", () => {
    expect(gameTabForKey(strip, "c", "ArrowRight")).toBe("a");
    expect(gameTabForKey(strip, "a", "ArrowLeft")).toBe("c");
  });

  it("goes to the first and the last tab", () => {
    expect(gameTabForKey(strip, "b", "Home")).toBe("a");
    expect(gameTabForKey(strip, "b", "End")).toBe("c");
  });

  it("leaves every other key alone", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Delete", "a"]) expect(gameTabForKey(strip, "b", key)).toBeNull();
  });

  it("has nowhere to go from a tab that isn't in the strip", () => {
    expect(gameTabForKey(strip, "x", "ArrowRight")).toBeNull();
  });
});

describe("tabTitleParts", () => {
  it("splits a game's title into its two teams", () => {
    expect(tabTitleParts("Fryshuset Basketbollklubb vs AIK")).toEqual({ home: "Fryshuset Basketbollklubb", away: "AIK" });
  });

  it("splits at the first vs only", () => {
    expect(tabTitleParts("A vs B vs C")).toEqual({ home: "A", away: "B vs C" });
  });

  it("leaves a title the coach wrote as it is", () => {
    expect(tabTitleParts("Cup final")).toBeNull();
    expect(tabTitleParts("Canvas")).toBeNull();
  });

  it("needs a team on both sides", () => {
    expect(tabTitleParts(" vs AIK")).toBeNull();
    expect(tabTitleParts("AIK vs ")).toBeNull();
    expect(tabTitleParts("")).toBeNull();
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

  it("keeps a game opened while the read was out", () => {
    const s = reconcileGameTabs(st(["a", "b", "c"]), [{ id: "a", title: "A2", date: null }], null, ["a", "b"]);
    expect(ids(s)).toEqual(["a", "c"]);
    expect(s.tabs.map((tab) => tab.title)).toEqual(["A2", "C"]);
    expect(s.recent).toEqual(["c", "a"]);
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
