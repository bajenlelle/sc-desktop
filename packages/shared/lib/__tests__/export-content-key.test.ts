import { describe, expect, it } from "vitest";
import { exportContentKey, type ExportContentInput } from "../export-content-key";
import { highlightContentKey, type HighlightContentSegment } from "../highlight-shares-db";
import type { StatsCardSpec } from "../stats-card";
import type { PlayByPlayEvent, Playlist, PlaylistItem, SyncPoint } from "../../types/match";

function event(eventId: number, realWorldTime: string, period = 1): PlayByPlayEvent {
  return {
    eventId,
    type: "2pt",
    subType: "jumpshot",
    period,
    gameClockTime: "09:00",
    realWorldTime,
    isSuccessful: 1,
    qualifiers: [],
  };
}

// m1: synced, its copy 50 minutes long. m2: synced, the copy's length unknown.
// m3: no sync (no ready copy), so none of its clips can render.
const S1: SyncPoint = { syncVideoTime: 100, syncRealWorldTime: "2026-10-12T18:00:00.000Z" };
const S2: SyncPoint = { syncVideoTime: 50, syncRealWorldTime: "2026-10-12T19:00:00.000Z" };
const E1 = event(1, "2026-10-12T18:01:00.000Z"); // 160 s into m1's copy
const E2 = event(2, "2026-10-12T18:05:00.000Z"); // 400 s
const E7 = event(7, "2026-10-12T19:10:00.000Z"); // 650 s into m2's copy
const E9 = event(9, "2026-10-12T18:50:00.000Z"); // 3100 s: past m1's 3000 s copy
const E4 = event(4, "2026-10-12T20:00:00.000Z");

const EVENTS = new Map<string, PlayByPlayEvent>([
  ["m1:1", E1],
  ["m1:2", E2],
  ["m2:7", E7],
  ["m1:9", E9],
  ["m3:4", E4],
]);
const SYNCS = new Map<string, SyncPoint>([
  ["m1", S1],
  ["m2", S2],
]);
const DURATIONS = new Map<string, number | null>([
  ["m1", 3000],
  ["m2", null],
]);

const SPEC: StatsCardSpec = {
  type: "stats",
  v: 1,
  source: "genius_hosted",
  scope: "game",
  player: { id: "42", name: "Alva Berg", number: "7", teamId: "1", teamName: "Bajen" },
  game: { matchId: "m1", sourceGameId: "9", competitionId: 1, opponent: "AIK", date: "2026-10-12", home: true, us: 84, them: 79 },
  line: { min: 1800, pts: 24, fgm: 9, fga: 14, tpm: 3, tpa: 5, ftm: 3, fta: 4, oreb: 3, dreb: 7, ast: 5, stl: 1, blk: 0, tov: 2, pf: 3, pm: 12 },
  columns: ["pts", "reb", "ast"],
  heading: null,
  details: null,
  asOf: "2026-10-17T10:00:00Z",
};

const PAN = [
  { t: 640, cx: 0.3 },
  { t: 652, cx: 0.6 },
];

const ITEMS: PlaylistItem[] = [
  { type: "clip", matchId: "m1", eventId: 1, preRollOffset: 2 },
  { type: "text", id: "c1", text: "Halftime", durationSeconds: 4 },
  { type: "clip", matchId: "m3", eventId: 4 },
  { type: "clip", matchId: "m2", eventId: 7, cropKeyframes: PAN },
  { type: "clip", matchId: "m1", eventId: 5 }, // its play is no longer in the game's data
  { type: "clip", matchId: "m1", eventId: 9 },
  { type: "text", id: "c2", text: "Alva Berg 24 pts", durationSeconds: 5, card: SPEC },
  { type: "clip", matchId: "m1", eventId: 2, postRollOffset: -1 },
];

function playlist(items: PlaylistItem[] = ITEMS, rolls: { preRoll?: number; postRoll?: number } = { preRoll: 8, postRoll: 2 }): Playlist {
  return { id: "p1", name: "Highlights", items, ...rolls };
}

function input(overrides: Partial<ExportContentInput> = {}): ExportContentInput {
  return {
    playlist: playlist(),
    eventByKey: EVENTS,
    syncByMatch: SYNCS,
    copyDurationByMatch: DURATIONS,
    aspect: "16:9",
    ...overrides,
  };
}

/**
 * What the desktop renders for ITEMS, written out by hand: buildExportSegments
 * (playlists.tsx) leaves out the play that is gone and the game without a
 * sync, and dropClipsOutsideVideos (lib/export.ts) the clip that starts past
 * its video's end; cards keep their text, duration and spec.
 */
const DESKTOP_SEGMENTS: HighlightContentSegment[] = [
  { kind: "clip", matchId: "m1", event: E1, syncPoint: S1, preRollOffset: 2 },
  { kind: "text", text: "Halftime", durationSeconds: 4 },
  { kind: "clip", matchId: "m2", event: E7, syncPoint: S2, cropKeyframes: PAN },
  { kind: "text", text: "Alva Berg 24 pts", durationSeconds: 5, card: SPEC },
  { kind: "clip", matchId: "m1", event: E2, syncPoint: S1, postRollOffset: -1 },
];

describe("exportContentKey", () => {
  it("is the desktop's key for the same rows, in both aspects", () => {
    expect(exportContentKey(input()).key).toBe(highlightContentKey(DESKTOP_SEGMENTS, 8, 2, "16:9"));
    expect(exportContentKey(input({ aspect: "9:16" })).key).toBe(highlightContentKey(DESKTOP_SEGMENTS, 8, 2, "9:16"));
  });

  it("counts what renders and names the clip it drops", () => {
    const out = exportContentKey(input({ aspect: "9:16" }));
    expect(out.clips).toBe(3);
    expect(out.cards).toBe(2);
    expect(out.pannedClips).toBe(1);
    expect(out.dropped).toEqual([{ matchId: "m1", eventId: 9, reason: "past_end" }]);
  });

  it("a clip that starts past its copy's end changes nothing", () => {
    const without = ITEMS.filter((i) => !(i.type === "clip" && i.eventId === 9));
    const a = exportContentKey(input());
    const b = exportContentKey(input({ playlist: playlist(without) }));
    expect(a.key).toBe(b.key);
    expect(b.dropped).toEqual([]);
    expect(a.clips).toBe(b.clips);
  });

  it("drops at the desktop's edge: starting in the copy's last quarter second is past the end", () => {
    // m1:2 sits at 400 s; with 8 s before (and no offset) it starts at 392 s.
    const items: PlaylistItem[] = [{ type: "clip", matchId: "m1", eventId: 2 }];
    const at = (duration: number) =>
      exportContentKey(input({ playlist: playlist(items), copyDurationByMatch: new Map([["m1", duration]]) }));
    expect(at(392.25).dropped).toHaveLength(1);
    expect(at(392.26).dropped).toHaveLength(0);
    expect(at(392.26).clips).toBe(1);
  });

  it("keeps every clip of a copy whose length is unknown", () => {
    const out = exportContentKey(input({ copyDurationByMatch: new Map() }));
    expect(out.dropped).toEqual([]);
    expect(out.clips).toBe(4);
  });

  it("16:9 ignores pans; 9:16 keys and counts them", () => {
    const unpanned = ITEMS.map((i) => (i.type === "clip" && i.eventId === 7 ? { ...i, cropKeyframes: undefined } : i));
    const moved = ITEMS.map((i) => (i.type === "clip" && i.eventId === 7 ? { ...i, cropKeyframes: [{ t: 640, cx: 0.7 }] } : i));
    const wide = (items: PlaylistItem[]) => exportContentKey(input({ playlist: playlist(items) }));
    const tall = (items: PlaylistItem[]) => exportContentKey(input({ playlist: playlist(items), aspect: "9:16" }));
    expect(wide(unpanned).key).toBe(wide(ITEMS).key);
    expect(wide(moved).key).toBe(wide(ITEMS).key);
    expect(wide(ITEMS).pannedClips).toBe(0);
    expect(tall(unpanned).key).not.toBe(tall(ITEMS).key);
    expect(tall(moved).key).not.toBe(tall(ITEMS).key);
    expect(tall(unpanned).pannedClips).toBe(0);
  });

  it("a selection exports its items in playlist order, whatever order it lists them in", () => {
    const selection = ["m1:2", "text:c1", "m1:1"];
    const out = exportContentKey(input({ selection }));
    const expected: HighlightContentSegment[] = [DESKTOP_SEGMENTS[0], DESKTOP_SEGMENTS[1], DESKTOP_SEGMENTS[4]];
    expect(out.key).toBe(highlightContentKey(expected, 8, 2, "16:9"));
    expect(out.clips).toBe(2);
    expect(out.cards).toBe(1);
    expect(exportContentKey(input({ selection: new Set(selection) })).key).toBe(out.key);
  });

  it("uses the playlist's clip length, and the app default when it has none", () => {
    expect(exportContentKey(input({ playlist: playlist(ITEMS, { preRoll: 6, postRoll: 2 }) })).key).not.toBe(exportContentKey(input()).key);
    expect(exportContentKey(input({ playlist: playlist(ITEMS, {}) })).key).toBe(highlightContentKey(DESKTOP_SEGMENTS, 10, 3, "16:9"));
  });

  it("follows a sync change: the same clips placed elsewhere in the video are new content", () => {
    const moved = new Map(SYNCS).set("m2", { ...S2, syncVideoTime: 55 });
    expect(exportContentKey(input({ syncByMatch: moved })).key).not.toBe(exportContentKey(input()).key);
  });

  it("an empty playlist still has a key, and nothing to count", () => {
    const out = exportContentKey(input({ playlist: playlist([]) }));
    expect(out.key).toBe(highlightContentKey([], 8, 2, "16:9"));
    expect(out).toMatchObject({ clips: 0, cards: 0, pannedClips: 0, dropped: [] });
  });
});
