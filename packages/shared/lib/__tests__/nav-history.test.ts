import { describe, expect, it } from "vitest";
import {
  EMPTY_NAV_HISTORY,
  NAV_HISTORY_LIMIT,
  canGoForward,
  navCurrent,
  navPrevious,
  navStep,
  navTitle,
  type NavHistory,
} from "../nav-history";

const at = (key: string, path: string, root = false) => ({ key, path, root });

function walk(...steps: [Parameters<typeof navStep>[1], ReturnType<typeof at>][]): NavHistory {
  return steps.reduce((h, [action, arrival]) => navStep(h, action, arrival), EMPTY_NAV_HISTORY);
}

describe("navStep", () => {
  it("starts over on the first location (a POP the router reports at launch)", () => {
    const h = walk(["POP", at("default", "/teams")]);
    expect(h.entries.map((e) => e.path)).toEqual(["/teams"]);
    expect(navPrevious(h)).toBeNull();
  });

  it("pushes, and Back is the page before", () => {
    const h = walk(["POP", at("default", "/teams/1/2")], ["PUSH", at("a", "/matches/x")]);
    expect(navCurrent(h)?.path).toBe("/matches/x");
    expect(navPrevious(h)?.path).toBe("/teams/1/2");
  });

  it("a POP to a known key moves the index, leaving the pages ahead for Forward", () => {
    let h = walk(["POP", at("default", "/teams/1/2")], ["PUSH", at("a", "/matches/x")]);
    h = navStep(h, "POP", at("default", "/teams/1/2"));
    expect(h.index).toBe(0);
    expect(canGoForward(h)).toBe(true);
    h = navStep(h, "POP", at("a", "/matches/x"));
    expect(h.index).toBe(1);
    expect(canGoForward(h)).toBe(false);
  });

  it("a push after going back drops the pages that were ahead", () => {
    let h = walk(["POP", at("default", "/a")], ["PUSH", at("b", "/b")], ["PUSH", at("c", "/c")]);
    h = navStep(h, "POP", at("b", "/b"));
    h = navStep(h, "PUSH", at("d", "/d"));
    expect(h.entries.map((e) => e.path)).toEqual(["/a", "/b", "/d"]);
    expect(canGoForward(h)).toBe(false);
  });

  it("a replace keeps the entry (its id and its name on the same page) and follows the new key", () => {
    let h = walk(["POP", at("default", "/teams/1/2")]);
    const id = navCurrent(h)!.id;
    h = navTitle(h, id, "Fryshuset");
    h = navStep(h, "REPLACE", at("r1", "/teams/1/2?view=plays"));
    expect(navCurrent(h)).toMatchObject({ id, key: "r1", title: "Fryshuset" });
    // Back to it later finds it by its new key.
    h = navStep(h, "PUSH", at("b", "/matches/x"));
    h = navStep(h, "POP", at("r1", "/teams/1/2?view=plays"));
    expect(h.index).toBe(0);
  });

  it("a replace onto another page (a switch between open games) is an entry of its own in the same place", () => {
    let h = walk(["POP", at("default", "/teams/1/2")], ["PUSH", at("a", "/matches/x")]);
    const was = navCurrent(h)!.id;
    h = navTitle(h, was, "AIK vs Djurgården");
    h = navStep(h, "REPLACE", at("r", "/matches/y"));
    expect(navCurrent(h)?.title).toBeNull();
    // A new id: what the replaced game kept (its scroll) is not the next game's.
    expect(navCurrent(h)?.id).not.toBe(was);
    expect(h.entries.map((e) => e.path)).toEqual(["/teams/1/2", "/matches/y"]);
  });

  it("a POP to an entry never seen (after a reload) starts over", () => {
    let h = walk(["POP", at("default", "/a")], ["PUSH", at("b", "/b")]);
    h = navStep(h, "POP", at("zzz", "/c"));
    expect(h.entries.map((e) => e.path)).toEqual(["/c"]);
    expect(navPrevious(h)).toBeNull();
  });

  it("keeps the sidebar's mark on the entry", () => {
    const h = walk(["POP", at("default", "/teams/1/2")], ["PUSH", at("a", "/matches", true)]);
    expect(navCurrent(h)?.root).toBe(true);
  });

  it("keeps at most the limit, dropping the oldest", () => {
    let h = walk(["POP", at("default", "/0")]);
    for (let i = 1; i <= NAV_HISTORY_LIMIT + 5; i++) h = navStep(h, "PUSH", at(`k${i}`, `/${i}`));
    expect(h.entries).toHaveLength(NAV_HISTORY_LIMIT);
    expect(navCurrent(h)?.path).toBe(`/${NAV_HISTORY_LIMIT + 5}`);
    expect(h.index).toBe(NAV_HISTORY_LIMIT - 1);
  });
});

describe("navTitle", () => {
  it("names an entry, and leaves the history as it was when nothing changes", () => {
    const h = walk(["POP", at("default", "/a")]);
    const id = navCurrent(h)!.id;
    const named = navTitle(h, id, "Teams");
    expect(navCurrent(named)?.title).toBe("Teams");
    expect(navTitle(named, id, "Teams")).toBe(named);
    expect(navTitle(named, 999, "X")).toBe(named);
  });
});
