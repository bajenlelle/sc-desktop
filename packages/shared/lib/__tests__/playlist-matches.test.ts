import { describe, expect, it } from "vitest";
import {
  buildAggregatedTeamMap,
  collectClipMatchIds,
  collectReferencedMatchIds,
  mergeEventsIntoMatches,
} from "../playlist-matches";
import type {
  Playlist,
  PlaylistClipItem,
  PlaylistTextCard,
  PlayByPlayEvent,
  StoredMatch,
} from "../../types/match";
import type { OrgTeam } from "../../types/org";

function clip(partial: Partial<PlaylistClipItem>): PlaylistClipItem {
  return { type: "clip", matchId: "m1", eventId: 1, ...partial };
}

function textCard(partial: Partial<PlaylistTextCard>): PlaylistTextCard {
  return { type: "text", id: "tc1", text: "Watch the screen", durationSeconds: 5, ...partial };
}

function pl(partial: Partial<Playlist>): Playlist {
  return { id: "p1", name: "Playlist", items: [], ...partial };
}

function match(partial: Partial<StoredMatch>): StoredMatch {
  return {
    id: "m1",
    title: "Bajen vs Alvik",
    date: "2026-01-10",
    homeTeam: { name: "Bajen", color: "#111111" },
    awayTeam: { name: "Alvik", color: "#222222" },
    homeRoster: [],
    awayRoster: [],
    events: [],
    ...partial,
  };
}

function ev(partial: Partial<PlayByPlayEvent>): PlayByPlayEvent {
  return {
    eventId: 1,
    type: "2pt",
    subType: "jumpshot",
    period: 1,
    gameClockTime: "09:45:00",
    realWorldTime: "2026-01-10T18:05:00Z",
    isSuccessful: 1,
    qualifiers: [],
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

describe("collectReferencedMatchIds", () => {
  it("collects unique matchIds from shipped clips across playlists", () => {
    const ids = collectReferencedMatchIds([
      pl({
        items: [
          clip({ matchId: "m1", r2Url: "https://r2/a.mp4" }),
          clip({ matchId: "m2", eventId: 2, r2Url: "https://r2/b.mp4" }),
        ],
      }),
      pl({ id: "p2", items: [clip({ matchId: "m1", eventId: 3, r2Url: "https://r2/c.mp4" })] }),
    ]);
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("ignores text cards and clips not yet shipped to R2", () => {
    const ids = collectReferencedMatchIds([
      pl({
        items: [
          textCard({}),
          clip({ matchId: "unshipped" }),
          clip({ matchId: "empty", r2Url: "" }), // falsy check — empty string counts as unshipped
          clip({ matchId: "shipped", r2Url: "https://r2/a.mp4" }),
        ],
      }),
    ]);
    expect(ids).toEqual(["shipped"]);
  });

  it("is empty for no playlists or clipless playlists", () => {
    expect(collectReferencedMatchIds([])).toEqual([]);
    expect(collectReferencedMatchIds([pl({}), pl({ id: "p2", items: [textCard({})] })])).toEqual([]);
  });
});

describe("mergeEventsIntoMatches", () => {
  it("fills each shell's events from the lookup, [] when the id misses", () => {
    const hit = ev({ eventId: 7 });
    const merged = mergeEventsIntoMatches(
      [match({ id: "m1" }), match({ id: "m2", title: "Alvik vs Vasa" })],
      { m1: [hit] },
    );
    expect(merged[0].events).toEqual([hit]);
    expect(merged[1].events).toEqual([]);
  });

  it("preserves the shells' other fields", () => {
    const [merged] = mergeEventsIntoMatches(
      [match({ id: "m1", videoUrl: "https://video/m1.mp4", orgId: "o1" })],
      { m1: [] },
    );
    expect(merged).toMatchObject({
      id: "m1",
      title: "Bajen vs Alvik",
      videoUrl: "https://video/m1.mp4",
      orgId: "o1",
    });
  });

  it("replaces events a shell already carried", () => {
    const fresh = ev({ eventId: 2 });
    const [merged] = mergeEventsIntoMatches([match({ id: "m1", events: [ev({})] })], {
      m1: [fresh],
    });
    expect(merged.events).toEqual([fresh]);
  });

  it("does not mutate the shells", () => {
    const shell = match({ id: "m1" });
    const shells = [shell];
    const merged = mergeEventsIntoMatches(shells, { m1: [ev({})] });
    expect(merged).not.toBe(shells);
    expect(merged[0]).not.toBe(shell);
    expect(shell.events).toEqual([]);
  });
});

describe("buildAggregatedTeamMap", () => {
  it("skips null entries without breaking the rest", () => {
    const map = buildAggregatedTeamMap(
      [null, { orgName: "Bajen", teams: [team({})] }, null],
      false,
    );
    expect([...map.keys()]).toEqual(["t1"]);
  });

  it("prefixes team names with the club only in the multi-club feed", () => {
    const entries = [{ orgName: "Bajen", teams: [team({})] }];
    expect(buildAggregatedTeamMap(entries, true).get("t1")?.name).toBe("Bajen · U16");
    expect(buildAggregatedTeamMap(entries, false).get("t1")?.name).toBe("U16");
  });

  it("keeps the raw name when multiClub but the orgName is missing", () => {
    const map = buildAggregatedTeamMap([{ teams: [team({})] }], true);
    expect(map.get("t1")?.name).toBe("U16");
  });

  it("copies teams instead of mutating them, preserving other fields", () => {
    const original = team({});
    const map = buildAggregatedTeamMap([{ orgName: "Bajen", teams: [original] }], true);
    expect(original.name).toBe("U16");
    expect(map.get("t1")).toMatchObject({ id: "t1", orgId: "o1", sport: "basketball" });
    expect(map.get("t1")).not.toBe(original);
  });

  it("lets a later duplicate team id overwrite the earlier one", () => {
    const map = buildAggregatedTeamMap(
      [
        { orgName: "Bajen", teams: [team({ name: "First" })] },
        { orgName: "Alvik", teams: [team({ name: "Second" })] },
      ],
      true,
    );
    expect(map.size).toBe(1);
    expect(map.get("t1")?.name).toBe("Alvik · Second");
  });

  it("is empty for no entries", () => {
    expect(buildAggregatedTeamMap([], true).size).toBe(0);
  });
});

describe("collectClipMatchIds", () => {
  it("collects unique matchIds from every clip, shipped or not", () => {
    const ids = collectClipMatchIds([
      pl({
        items: [
          clip({ matchId: "m1", r2Url: "https://r2/a.mp4" }),
          clip({ matchId: "m2", eventId: 2 }), // unshipped
        ],
      }),
      pl({ id: "p2", items: [clip({ matchId: "m3", eventId: 3 })] }),
    ]);
    expect(ids).toEqual(["m1", "m2", "m3"]);
  });

  it("includes matches whose clips are ALL unshipped — the editor case that collectReferencedMatchIds drops", () => {
    const playlists = [pl({ items: [clip({ matchId: "draft" })] })];
    expect(collectReferencedMatchIds(playlists)).toEqual([]);
    expect(collectClipMatchIds(playlists)).toEqual(["draft"]);
  });

  it("ignores text cards", () => {
    const ids = collectClipMatchIds([pl({ items: [textCard({}), clip({ matchId: "m9" })] })]);
    expect(ids).toEqual(["m9"]);
  });

  it("returns [] for playlists with no clips", () => {
    expect(collectClipMatchIds([pl({ items: [] })])).toEqual([]);
    expect(collectClipMatchIds([])).toEqual([]);
  });
});
