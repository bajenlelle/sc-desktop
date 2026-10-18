import { describe, expect, it } from "vitest";
import { buildWatchItems, isMultiGame, type WatchItem } from "../watch-queue";
import type { Playlist, PlayByPlayEvent, SyncPoint } from "../../types/match";

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

// Tip-off at 10:00:00Z sits 600 s into the video.
const sync: SyncPoint = { syncVideoTime: 600, syncRealWorldTime: "2026-10-18T10:00:00Z" };

const playlist: Playlist = {
  id: "pl",
  name: "Windows",
  items: [
    { type: "clip", matchId: "m1", eventId: 1, r2Url: "https://media/clips/m1/1.mp4" },
    { type: "clip", matchId: "m1", eventId: 2 },
    { type: "clip", matchId: "m1", eventId: 3, preRollOffset: -4, postRollOffset: 2 },
    { type: "clip", matchId: "m2", eventId: 1 },
  ],
} as unknown as Playlist;

const events = new Map<string, PlayByPlayEvent>([
  ["m1:1", event(1, "2026-10-18T10:00:30Z")],
  ["m1:2", event(2, "2026-10-18T10:01:00Z")],
  ["m1:3", event(3, "2026-10-18T10:02:00Z")],
  ["m2:1", event(1, "2026-10-18T10:00:00Z")],
]);

describe("buildWatchItems with cloud copies", () => {
  it("still drops clips without a file when the viewer has no copy of the game", () => {
    const items = buildWatchItems(playlist, events);
    expect(items.map((i) => i.kind)).toEqual(["clip"]);
  });

  it("plays a clip without a file as a window of the game's copy, with the playlist's rolls and the clip's offsets", () => {
    const items = buildWatchItems(playlist, events, { syncByMatch: new Map([["m1", sync]]) });
    expect(items.map((i) => i.kind)).toEqual(["clip", "window", "window"]);
    const second = items[1] as Extract<WatchItem, { kind: "window" }>;
    // 10:01:00 is 60 s after tip-off: video time 660; default rolls 10 before, 3 after.
    expect(second).toMatchObject({ key: "m1:2", matchId: "m1", start: 650, end: 663 });
    const third = items[2] as Extract<WatchItem, { kind: "window" }>;
    // 720 s, with 4 s less before and 2 s more after.
    expect(third).toMatchObject({ key: "m1:3", start: 714, end: 725 });
    // m2 has no copy: still left out.
    expect(items.some((i) => i.kind !== "text" && i.matchId === "m2")).toBe(false);
  });

  it("uses the playlist's own clip length when it has one", () => {
    const longer = { ...playlist, preRoll: 20, postRoll: 5 } as Playlist;
    const items = buildWatchItems(longer, events, { syncByMatch: new Map([["m1", sync]]) });
    expect(items[1]).toMatchObject({ kind: "window", start: 640, end: 665 });
  });

  it("prefers the uploaded file when there is one", () => {
    const items = buildWatchItems(playlist, events, { syncByMatch: new Map([["m1", sync]]) });
    expect(items[0]).toMatchObject({ kind: "clip", r2Url: "https://media/clips/m1/1.mp4" });
  });

  it("counts windows' games towards multi-game playlists", () => {
    const both = buildWatchItems(playlist, events, {
      syncByMatch: new Map([
        ["m1", sync],
        ["m2", sync],
      ]),
    });
    expect(isMultiGame(both)).toBe(true);
    expect(isMultiGame(buildWatchItems(playlist, events, { syncByMatch: new Map([["m1", sync]]) }))).toBe(false);
  });
});
