import { describe, expect, it } from "vitest";
import { noteOpened, parseRecentOpens, RECENT_OPENS_MAX, type RecentOpen } from "../recent-opens";

describe("noteOpened", () => {
  it("puts what was just opened first", () => {
    const list = noteOpened([{ kind: "game", id: "g1", at: 100 }], { kind: "playlist", id: "p1" }, 200);
    expect(list).toEqual([
      { kind: "playlist", id: "p1", at: 200 },
      { kind: "game", id: "g1", at: 100 },
    ]);
  });

  it("keeps one entry per thing: opening it again moves it to the front", () => {
    const before: RecentOpen[] = [
      { kind: "game", id: "g1", at: 300 },
      { kind: "playlist", id: "p1", at: 200 },
    ];
    expect(noteOpened(before, { kind: "playlist", id: "p1" }, 400)).toEqual([
      { kind: "playlist", id: "p1", at: 400 },
      { kind: "game", id: "g1", at: 300 },
    ]);
  });

  it("tells a playlist from its report: they share the playlist's id", () => {
    const list = noteOpened([{ kind: "playlist", id: "p1", at: 100 }], { kind: "report", id: "p1" }, 200);
    expect(list.map((r) => r.kind)).toEqual(["report", "playlist"]);
  });

  it("forgets the oldest past the limit", () => {
    let list: RecentOpen[] = [];
    for (let i = 0; i < RECENT_OPENS_MAX + 3; i++) list = noteOpened(list, { kind: "game", id: `g${i}` }, i);
    expect(list).toHaveLength(RECENT_OPENS_MAX);
    expect(list[0].id).toBe(`g${RECENT_OPENS_MAX + 2}`);
    expect(list.at(-1)?.id).toBe("g3");
  });

  it("leaves the list it was given alone", () => {
    const before: RecentOpen[] = [{ kind: "game", id: "g1", at: 100 }];
    noteOpened(before, { kind: "game", id: "g2" }, 200);
    expect(before).toEqual([{ kind: "game", id: "g1", at: 100 }]);
  });
});

describe("parseRecentOpens", () => {
  it("reads back what was stored", () => {
    const stored = JSON.parse(JSON.stringify([{ kind: "report", id: "p1", at: 5 }]));
    expect(parseRecentOpens(stored)).toEqual([{ kind: "report", id: "p1", at: 5 }]);
  });

  it("is empty for anything that isn't a list", () => {
    expect(parseRecentOpens(null)).toEqual([]);
    expect(parseRecentOpens("x")).toEqual([]);
    expect(parseRecentOpens({ kind: "game", id: "g1", at: 1 })).toEqual([]);
  });

  it("drops entries it can't read and keeps the rest", () => {
    const raw = [
      { kind: "game", id: "g1", at: 3 },
      { kind: "clip", id: "c1", at: 2 },
      { kind: "playlist", id: 7, at: 2 },
      { kind: "playlist", id: "p1" },
      null,
      { kind: "playlist", id: "p2", at: 1 },
    ];
    expect(parseRecentOpens(raw)).toEqual([
      { kind: "game", id: "g1", at: 3 },
      { kind: "playlist", id: "p2", at: 1 },
    ]);
  });

  it("never returns more than the limit", () => {
    const raw = Array.from({ length: RECENT_OPENS_MAX + 5 }, (_, i) => ({ kind: "game", id: `g${i}`, at: i }));
    expect(parseRecentOpens(raw)).toHaveLength(RECENT_OPENS_MAX);
  });
});
