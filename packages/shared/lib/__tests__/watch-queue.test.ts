import { describe, expect, it } from "vitest";
import {
  buildWatchItems,
  clipKey,
  firstUnwatchedKey,
  isMultiGame,
  recordOnce,
  watchProgress,
} from "../watch-queue";
import { clipViewKey } from "../clip-views-db";
import type { Playlist, PlayByPlayEvent, PlaylistClipItem, PlaylistTextCard } from "../../types/match";

function event(eventId: number): PlayByPlayEvent {
  return {
    eventId,
    type: "3pt",
    subType: "jumpshot",
    period: 1,
    gameClockTime: "09:12",
    realWorldTime: "2026-09-20T17:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
  };
}

function clip(matchId: string, eventId: number, partial: Partial<PlaylistClipItem> = {}): PlaylistClipItem {
  return { type: "clip", matchId, eventId, r2Url: `https://r2.example/${matchId}-${eventId}.mp4`, ...partial };
}

function card(id: string): PlaylistTextCard {
  return { type: "text", id, text: "Box out", durationSeconds: 4 };
}

function playlist(items: Playlist["items"]): Playlist {
  return { id: "pl1", name: "Defence", items };
}

const events = new Map<string, PlayByPlayEvent>([
  ["m1:1", event(1)],
  ["m1:2", event(2)],
  ["m2:1", event(1)],
]);

describe("buildWatchItems", () => {
  it("keeps the playlist's order, clips and text cards alike", () => {
    const items = buildWatchItems(playlist([clip("m1", 1), card("c1"), clip("m1", 2)]), events);
    expect(items.map((i) => i.key)).toEqual(["m1:1", "text:c1", "m1:2"]);
    expect(items[1]).toMatchObject({ kind: "text", card: { text: "Box out" } });
  });

  it("leaves out clips that are not uploaded or whose play is missing", () => {
    const items = buildWatchItems(
      playlist([clip("m1", 1, { r2Url: undefined }), clip("m1", 9), clip("m1", 2)]),
      events,
    );
    expect(items.map((i) => i.key)).toEqual(["m1:2"]);
  });

  it("tells apart clips from two games that share an event id", () => {
    const items = buildWatchItems(playlist([clip("m1", 1), clip("m2", 1)]), events);
    expect(items.map((i) => i.key)).toEqual(["m1:1", "m2:1"]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it("carries the clip's file and the coach's note", () => {
    const [item] = buildWatchItems(playlist([clip("m1", 1, { note: "Watch the screen" })]), events);
    expect(item).toMatchObject({ kind: "clip", matchId: "m1", r2Url: "https://r2.example/m1-1.mp4", note: "Watch the screen" });
  });
});

describe("isMultiGame", () => {
  it("is true only when clips come from more than one game", () => {
    expect(isMultiGame(buildWatchItems(playlist([clip("m1", 1), clip("m1", 2), card("c")]), events))).toBe(false);
    expect(isMultiGame(buildWatchItems(playlist([clip("m1", 1), clip("m2", 1)]), events))).toBe(true);
    expect(isMultiGame([])).toBe(false);
  });
});

describe("firstUnwatchedKey", () => {
  const pl = playlist([clip("m1", 1, { r2Url: undefined }), clip("m1", 2), clip("m2", 1)]);

  it("starts at the first uploaded clip not yet watched", () => {
    expect(firstUnwatchedKey(pl, new Set())).toBe("m1:2");
    expect(firstUnwatchedKey(pl, new Set([clipViewKey("pl1", "m1", 2)]))).toBe("m2:1");
  });

  it("is null when everything uploaded has been watched", () => {
    const watched = new Set([clipViewKey("pl1", "m1", 2), clipViewKey("pl1", "m2", 1)]);
    expect(firstUnwatchedKey(pl, watched)).toBeNull();
    expect(firstUnwatchedKey(playlist([card("c")]), new Set())).toBeNull();
  });

  it("counts watches in this playlist only", () => {
    expect(firstUnwatchedKey(pl, new Set([clipViewKey("other", "m1", 2)]))).toBe("m1:2");
  });
});

describe("watchProgress", () => {
  it("counts uploaded clips only, so the total is reachable", () => {
    const pl = playlist([clip("m1", 1, { r2Url: undefined }), clip("m1", 2), card("c"), clip("m2", 1)]);
    expect(watchProgress(pl, new Set())).toEqual({ watched: 0, total: 2 });
    expect(watchProgress(pl, new Set([clipViewKey("pl1", "m2", 1)]))).toEqual({ watched: 1, total: 2 });
  });
});

describe("recordOnce", () => {
  it("claims a key the first time only", () => {
    const recorded = new Set<string>();
    expect(recordOnce(recorded, clipKey("m1", 1))).toBe(true);
    expect(recordOnce(recorded, clipKey("m1", 1))).toBe(false);
    expect(recordOnce(recorded, clipKey("m2", 1))).toBe(true);
    expect([...recorded]).toEqual(["m1:1", "m2:1"]);
  });
});
