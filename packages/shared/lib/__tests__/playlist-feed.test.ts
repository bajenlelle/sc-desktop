import { describe, expect, it } from "vitest";
import {
  byLastWatched,
  byNewest,
  computeHero,
  feedCounts,
  filterFeed,
  initials,
  matchesSource,
  playableClips,
  relativeTimeShort,
  sharerFilterOptions,
  toFeedPlaylists,
  visibleFeed,
  watchStateOf,
  type FeedContext,
  type FeedPlaylist,
} from "../playlist-feed";
import { clipViewKey } from "../clip-views-db";
import type { Playlist, PlaylistClipItem, PlaylistTextCard } from "../../types/match";
import type { OrgTeam, UserProfile } from "../../types/org";

function fp(partial: Partial<FeedPlaylist>): FeedPlaylist {
  return { id: "p", name: "Playlist", clipCount: 0, watchedCount: 0, ...partial };
}

function pl(partial: Partial<Playlist>): Playlist {
  return { id: "pl", name: "Playlist", items: [], ...partial };
}

function clip(partial: Partial<PlaylistClipItem>): PlaylistClipItem {
  return { type: "clip", matchId: "m1", eventId: 1, ...partial };
}

function textCard(partial: Partial<PlaylistTextCard>): PlaylistTextCard {
  return { type: "text", id: "txt", text: "Focus on spacing", durationSeconds: 5, ...partial };
}

function profile(partial: Partial<UserProfile>): UserProfile {
  return {
    id: "u1",
    fullName: null,
    avatarUrl: null,
    role: "coach",
    orgId: null,
    createdAt: "2026-01-01T00:00:00Z",
    isPlatformAdmin: false,
    ...partial,
  };
}

function team(partial: Partial<OrgTeam>): OrgTeam {
  return {
    id: "t1",
    orgId: "o1",
    name: "U16",
    sport: "basketball",
    season: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function ctx(partial: Partial<FeedContext> = {}): FeedContext {
  return {
    clipViews: new Set(),
    lastWatched: new Map(),
    memberMap: new Map(),
    teamMap: new Map(),
    directPlaylistIds: new Set(),
    ...partial,
  };
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

describe("playableClips", () => {
  it("keeps only clip items that have shipped to R2", () => {
    const shipped = clip({ eventId: 1, r2Url: "https://r2/clip1.mp4" });
    const playlist = pl({
      items: [
        shipped,
        clip({ eventId: 2 }), // unshipped: no r2Url
        textCard({}),
      ],
    });
    expect(playableClips(playlist)).toEqual([shipped]);
  });

  it("is empty for a playlist without items", () => {
    expect(playableClips(pl({}))).toEqual([]);
  });
});

describe("toFeedPlaylists", () => {
  it("excludes the user's own playlists, keeps them when userId is undefined", () => {
    const list = [pl({ id: "mine", createdBy: "me" }), pl({ id: "theirs", createdBy: "coach" })];
    expect(toFeedPlaylists(list, ctx({ userId: "me" })).map((p) => p.id)).toEqual(["theirs"]);
    expect(toFeedPlaylists(list, ctx({})).map((p) => p.id)).toEqual(["mine", "theirs"]);
  });

  it("counts only shipped clips — text cards and unshipped clips are invisible", () => {
    const playlist = pl({
      items: [
        clip({ eventId: 1, r2Url: "https://r2/1.mp4" }),
        clip({ eventId: 2, r2Url: "https://r2/2.mp4" }),
        clip({ eventId: 3 }),
        textCard({}),
      ],
    });
    const [fed] = toFeedPlaylists([playlist], ctx({}));
    expect(fed.clipCount).toBe(2);
  });

  it("derives watchedCount from clipViewKey membership in clipViews", () => {
    const playlist = pl({
      id: "plA",
      items: [
        clip({ matchId: "m1", eventId: 1, r2Url: "https://r2/1.mp4" }),
        clip({ matchId: "m1", eventId: 2, r2Url: "https://r2/2.mp4" }),
      ],
    });
    const views = new Set([
      clipViewKey("plA", "m1", 1),
      clipViewKey("otherPl", "m1", 2), // same clip watched in ANOTHER playlist: not counted
    ]);
    const [fed] = toFeedPlaylists([playlist], ctx({ clipViews: views }));
    expect(fed.watchedCount).toBe(1);
  });

  it("resolves sharerName from fullName, falls back to email, then undefined", () => {
    const memberMap = new Map([
      ["named", profile({ id: "named", fullName: "Coach Carter", email: "cc@club.se" })],
      ["emailOnly", profile({ id: "emailOnly", email: "anon@club.se" })],
      ["nameless", profile({ id: "nameless" })],
    ]);
    const list = [
      pl({ id: "a", sharedBy: "named" }),
      pl({ id: "b", sharedBy: "emailOnly" }),
      pl({ id: "c", sharedBy: "nameless" }),
      pl({ id: "d", sharedBy: "missing" }), // sharer not in memberMap
      pl({ id: "e" }), // no sharedBy at all
    ];
    const names = toFeedPlaylists(list, ctx({ memberMap })).map((p) => p.sharerName);
    expect(names).toEqual(["Coach Carter", "anon@club.se", undefined, undefined, undefined]);
  });

  it("maps sharerAvatarUrl and normalizes a null avatar to undefined", () => {
    const memberMap = new Map([
      ["s1", profile({ id: "s1", avatarUrl: "https://cdn/s1.png" })],
      ["s2", profile({ id: "s2", avatarUrl: null })],
    ]);
    const list = [pl({ id: "a", sharedBy: "s1" }), pl({ id: "b", sharedBy: "s2" })];
    const avatars = toFeedPlaylists(list, ctx({ memberMap })).map((p) => p.sharerAvatarUrl);
    expect(avatars).toEqual(["https://cdn/s1.png", undefined]);
  });

  it("flags isDirect from directPlaylistIds", () => {
    const list = [pl({ id: "direct" }), pl({ id: "viaTeam" })];
    const fed = toFeedPlaylists(list, ctx({ directPlaylistIds: new Set(["direct"]) }));
    expect(fed.map((p) => p.isDirect)).toEqual([true, false]);
  });

  it("resolves teamNames via teamMap and drops unknown ids", () => {
    const teamMap = new Map([["t1", team({ id: "t1", name: "U16" })]]);
    const [known, none] = toFeedPlaylists(
      [pl({ id: "a", teamIds: ["t1", "ghost"] }), pl({ id: "b" })],
      ctx({ teamMap }),
    );
    expect(known.teamIds).toEqual(["t1", "ghost"]); // ids pass through unfiltered
    expect(known.teamNames).toEqual(["U16"]);
    expect(none.teamIds).toEqual([]);
    expect(none.teamNames).toEqual([]);
  });

  it("carries sharedAt through and reads lastWatchedAt from the map", () => {
    const [fed] = toFeedPlaylists(
      [pl({ id: "plA", sharedAt: "2026-02-01T00:00:00Z" })],
      ctx({ lastWatched: new Map([["plA", "2026-03-01T00:00:00Z"]]) }),
    );
    expect(fed.sharedAt).toBe("2026-02-01T00:00:00Z");
    expect(fed.lastWatchedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("PARITY: badge count for new equals the feed's New section length", () => {
    const shipped = (eventId: number) => clip({ eventId, r2Url: `https://r2/${eventId}.mp4` });
    const list = [
      pl({ id: "fresh", items: [shipped(1), shipped(2)] }),
      pl({ id: "half", items: [shipped(3), shipped(4)] }),
      pl({ id: "done", items: [shipped(5)] }),
      pl({ id: "empty", items: [textCard({}), clip({ eventId: 6 })] }), // zero shipped clips
    ];
    const views = new Set([
      clipViewKey("half", "m1", 3),
      clipViewKey("done", "m1", 5),
    ]);
    const items = toFeedPlaylists(list, ctx({ clipViews: views }));

    const counts = feedCounts(items);
    const visible = visibleFeed(items, "new");
    expect(counts.new).toBe(visible.length);
    // The zero-clip playlist is "new" on BOTH surfaces — exact parity.
    expect(visible.map((p) => p.id)).toEqual(["fresh", "empty"]);
    expect(counts).toEqual({ all: 4, new: 2, progress: 1, watched: 1 });
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
