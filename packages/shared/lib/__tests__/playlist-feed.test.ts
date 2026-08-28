import { describe, expect, it } from "vitest";
import {
  byLastWatched,
  byNewest,
  computeHero,
  feedCounts,
  filterFeed,
  initials,
  matchesSource,
  relativeTimeShort,
  sharerFilterOptions,
  visibleFeed,
  watchStateOf,
  type FeedPlaylist,
} from "../playlist-feed";

function fp(partial: Partial<FeedPlaylist>): FeedPlaylist {
  return { id: "p", name: "Playlist", clipCount: 0, watchedCount: 0, ...partial };
}

describe("watchStateOf", () => {
  it("classifies new, progress, and watched", () => {
    expect(watchStateOf(fp({ clipCount: 5, watchedCount: 0 }))).toBe("new");
    expect(watchStateOf(fp({ clipCount: 5, watchedCount: 2 }))).toBe("progress");
    expect(watchStateOf(fp({ clipCount: 5, watchedCount: 5 }))).toBe("watched");
    expect(watchStateOf(fp({ clipCount: 5, watchedCount: 7 }))).toBe("watched");
  });

  it("treats empty playlists as new, or progress once anything was watched", () => {
    // Current quirk: clipCount 0 can never reach "watched" — a stray view on an
    // empty playlist pins it to "progress" forever.
    expect(watchStateOf(fp({ clipCount: 0, watchedCount: 0 }))).toBe("new");
    expect(watchStateOf(fp({ clipCount: 0, watchedCount: 1 }))).toBe("progress");
  });
});

describe("matchesSource", () => {
  it("passes everything for all", () => {
    expect(matchesSource(fp({}), "all")).toBe(true);
  });

  it("direct requires the direct flag", () => {
    expect(matchesSource(fp({ isDirect: true }), "direct")).toBe(true);
    expect(matchesSource(fp({}), "direct")).toBe(false);
  });

  it("team filters match teamIds and fail without them", () => {
    expect(matchesSource(fp({ teamIds: ["t1", "t2"] }), "team:t2")).toBe(true);
    expect(matchesSource(fp({ teamIds: ["t1"] }), "team:t9")).toBe(false);
    expect(matchesSource(fp({}), "team:t1")).toBe(false);
  });

  it("passes unknown source strings through", () => {
    // Current quirk: any unrecognized string behaves like "all".
    expect(matchesSource(fp({}), "garbage")).toBe(true);
  });
});

describe("byNewest / byLastWatched", () => {
  it("byNewest sorts by sharedAt descending, missing last", () => {
    const a = fp({ id: "a", sharedAt: "2026-01-01T00:00:00Z" });
    const b = fp({ id: "b", sharedAt: "2026-02-01T00:00:00Z" });
    const c = fp({ id: "c" });
    expect([a, c, b].sort(byNewest).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("byLastWatched prefers lastWatchedAt and falls back to sharedAt", () => {
    const resumed = fp({
      id: "resumed",
      sharedAt: "2026-01-01T00:00:00Z",
      lastWatchedAt: "2026-03-01T00:00:00Z",
    });
    const freshShare = fp({ id: "freshShare", sharedAt: "2026-02-01T00:00:00Z" });
    const neither = fp({ id: "neither" });
    expect([neither, freshShare, resumed].sort(byLastWatched).map((p) => p.id)).toEqual([
      "resumed",
      "freshShare",
      "neither",
    ]);
  });
});

describe("sharerFilterOptions", () => {
  it("hides the filter with fewer than two distinct sharers", () => {
    expect(sharerFilterOptions([])).toEqual([]);
    expect(
      sharerFilterOptions([
        fp({ sharerId: "s1", sharerName: "Coach" }),
        fp({ sharerId: "s1", sharerName: "Coach" }),
      ]),
    ).toEqual([]);
  });

  it("puts Everyone first and labels nameless sharers Unknown", () => {
    expect(
      sharerFilterOptions([
        fp({ sharerId: "s1", sharerName: "Coach" }),
        fp({ sharerId: "s2" }),
      ]),
    ).toEqual([
      { value: "all", label: "Everyone" },
      { value: "s1", label: "Coach" },
      { value: "s2", label: "Unknown" },
    ]);
  });

  it("dedupes by sharer id, keeping the first name seen", () => {
    const opts = sharerFilterOptions([
      fp({ sharerId: "s1", sharerName: "First" }),
      fp({ sharerId: "s1", sharerName: "Second" }),
      fp({ sharerId: "s2", sharerName: "Other" }),
    ]);
    expect(opts.find((o) => o.value === "s1")?.label).toBe("First");
  });
});

describe("filterFeed", () => {
  const list = [
    fp({ id: "p1", name: "Crunch Time", sharerId: "s1", teamIds: ["t1"] }),
    fp({ id: "p2", name: "Defense", sharerId: "s2", isDirect: true }),
  ];

  it("trims the query and matches case-insensitively", () => {
    expect(
      filterFeed(list, { query: "  CRUNCH ", sharer: "all", source: "all" }).map((p) => p.id),
    ).toEqual(["p1"]);
  });

  it("composes sharer and source filters", () => {
    expect(
      filterFeed(list, { query: "", sharer: "s2", source: "direct" }).map((p) => p.id),
    ).toEqual(["p2"]);
    expect(filterFeed(list, { query: "", sharer: "s2", source: "team:t1" })).toEqual([]);
  });
});

describe("feedCounts", () => {
  it("splits every playlist into exactly one state", () => {
    const list = [
      fp({ clipCount: 3, watchedCount: 0 }),
      fp({ clipCount: 3, watchedCount: 1 }),
      fp({ clipCount: 3, watchedCount: 3 }),
      fp({ clipCount: 3, watchedCount: 0 }),
    ];
    const c = feedCounts(list);
    expect(c).toEqual({ all: 4, new: 2, progress: 1, watched: 1 });
    expect(c.new + c.progress + c.watched).toBe(c.all);
  });
});

describe("visibleFeed", () => {
  const list = [
    fp({ id: "n", clipCount: 2, watchedCount: 0 }),
    fp({ id: "w", clipCount: 2, watchedCount: 2 }),
  ];

  it("returns the input unchanged for all", () => {
    expect(visibleFeed(list, "all")).toBe(list);
  });

  it("filters to the requested state", () => {
    expect(visibleFeed(list, "watched").map((p) => p.id)).toEqual(["w"]);
    expect(visibleFeed(list, "progress")).toEqual([]);
  });
});

describe("computeHero", () => {
  it("continue beats start and picks the most recently touched playlist", () => {
    const hero = computeHero([
      fp({ id: "fresh", clipCount: 2, watchedCount: 0, sharedAt: "2026-03-01T00:00:00Z" }),
      fp({
        id: "older",
        clipCount: 2,
        watchedCount: 1,
        lastWatchedAt: "2026-01-01T00:00:00Z",
      }),
      fp({
        id: "recent",
        clipCount: 2,
        watchedCount: 1,
        lastWatchedAt: "2026-02-01T00:00:00Z",
      }),
    ]);
    expect(hero).toMatchObject({ kind: "continue", playlist: { id: "recent" } });
  });

  it("start picks the newest unwatched playlist and counts all of them", () => {
    const hero = computeHero([
      fp({ id: "old", clipCount: 2, watchedCount: 0, sharedAt: "2026-01-01T00:00:00Z" }),
      fp({ id: "new", clipCount: 2, watchedCount: 0, sharedAt: "2026-02-01T00:00:00Z" }),
      fp({ id: "done", clipCount: 1, watchedCount: 1 }),
    ]);
    expect(hero).toMatchObject({ kind: "start", playlist: { id: "new" }, count: 2 });
  });

  it("is done when everything is watched, null when there is nothing", () => {
    expect(computeHero([fp({ clipCount: 1, watchedCount: 1 })])).toEqual({ kind: "done" });
    expect(computeHero([])).toBeNull();
  });
});

describe("relativeTimeShort", () => {
  const iso = "2026-01-15T12:00:00Z";
  const then = new Date(iso).getTime();

  it("scales from just now through days", () => {
    expect(relativeTimeShort(iso, then + 30_000)).toBe("just now");
    expect(relativeTimeShort(iso, then + 59 * 60_000)).toBe("59m ago");
    expect(relativeTimeShort(iso, then + 23 * 3_600_000)).toBe("23h ago");
    expect(relativeTimeShort(iso, then + 6 * 86_400_000)).toBe("6d ago");
  });

  it("switches to a sv-SE date at seven days", () => {
    const expected = new Date(iso).toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "short",
    });
    expect(relativeTimeShort(iso, then + 7 * 86_400_000)).toBe(expected);
  });

  it("is null for missing or unparseable input", () => {
    expect(relativeTimeShort(null, then)).toBeNull();
    expect(relativeTimeShort(undefined, then)).toBeNull();
    expect(relativeTimeShort("not a date", then)).toBeNull();
  });
});

describe("initials", () => {
  it("takes first and last name initials", () => {
    expect(initials("Leonard Halling")).toBe("LH");
    expect(initials("Anna Maria Svensson")).toBe("AS");
    expect(initials("  Leonard   Halling  ")).toBe("LH");
  });

  it("uses the first two letters of a single word", () => {
    expect(initials("leo")).toBe("LE");
  });

  it("falls back to a question mark", () => {
    expect(initials(null)).toBe("?");
    expect(initials(undefined)).toBe("?");
    expect(initials("")).toBe("?");
  });
});
