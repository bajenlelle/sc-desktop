import { describe, expect, it } from "vitest";
import { lastOpenedPlaylist, noteOpened, parseRecentOpens, RECENT_OPENS_MAX, type RecentOpen } from "../recent-opens";

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

  it("reads back a team", () => {
    expect(parseRecentOpens([{ kind: "team", id: "t1", at: 7 }])).toEqual([{ kind: "team", id: "t1", at: 7 }]);
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

describe("lastOpenedPlaylist", () => {
  const ids = new Set(["p1", "p2"]);

  it("takes the newest playlist, skipping newer games and teams", () => {
    const opens: RecentOpen[] = [
      { kind: "game", id: "g1", at: 400 },
      { kind: "team", id: "t1", at: 300 },
      { kind: "playlist", id: "p2", at: 200 },
      { kind: "playlist", id: "p1", at: 100 },
    ];
    expect(lastOpenedPlaylist(opens, ids)).toBe("p2");
  });

  it("counts a report as its playlist", () => {
    expect(lastOpenedPlaylist([{ kind: "report", id: "p1", at: 100 }], ids)).toBe("p1");
  });

  it("skips an id that is not a playlist any more", () => {
    const opens: RecentOpen[] = [
      { kind: "playlist", id: "gone", at: 200 },
      { kind: "playlist", id: "p1", at: 100 },
    ];
    expect(lastOpenedPlaylist(opens, ids)).toBe("p1");
  });

  it("is null when nothing is left or the list is empty", () => {
    expect(lastOpenedPlaylist([{ kind: "playlist", id: "gone", at: 100 }], ids)).toBeNull();
    expect(lastOpenedPlaylist([], ids)).toBeNull();
  });
});
