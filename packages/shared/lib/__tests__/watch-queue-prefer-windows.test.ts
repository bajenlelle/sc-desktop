import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, Playlist, SyncPoint } from "../../types/match";
import { buildWatchItems, clipKey } from "../watch-queue";

const sync: SyncPoint = { syncVideoTime: 300, syncRealWorldTime: "2026-10-04T13:00:00.000Z" };
const event = (eventId: number, secondsAfterSync: number): PlayByPlayEvent => ({
  eventId,
  type: "2pt",
  subType: "layup",
  period: 1,
  gameClockTime: "09:30",
  realWorldTime: new Date(Date.parse(sync.syncRealWorldTime) + secondsAfterSync * 1000).toISOString(),
  isSuccessful: 1,
  qualifiers: [],
});
const events = new Map([
  [clipKey("m1", 1), event(1, 30)],
  [clipKey("m1", 2), event(2, 90)],
]);
const playlist: Playlist = {
  id: "p",
  name: "P",
  items: [
    { type: "clip", matchId: "m1", eventId: 1, r2Url: "https://cdn/clips/m1/1_pre10.0_post3.0_s320.0.mp4" },
    { type: "clip", matchId: "m1", eventId: 2, preRollOffset: 2 },
  ],
};

describe("buildWatchItems with preferWindows", () => {
  it("plays an uploaded clip from its file by default, and as a window for the copy's owner who asks", () => {
    const cloud = { syncByMatch: new Map([["m1", sync]]) };
    const byDefault = buildWatchItems(playlist, events, cloud);
    expect(byDefault.map((i) => i.kind)).toEqual(["clip", "window"]);
    const preferred = buildWatchItems(playlist, events, { ...cloud, preferWindows: true });
    expect(preferred.map((i) => i.kind)).toEqual(["window", "window"]);
    const first = preferred[0];
    if (first.kind !== "window") throw new Error("expected a window");
    expect(first.start).toBe(320);
    expect(first.end).toBe(333);
    const second = preferred[1];
    if (second.kind !== "window") throw new Error("expected a window");
    expect(second.start).toBe(378);
  });

  it("falls back to the file when the copy cannot place the play", () => {
    const broken: PlayByPlayEvent = { ...event(1, 30), realWorldTime: "" };
    const items = buildWatchItems(playlist, new Map([[clipKey("m1", 1), broken]]), { syncByMatch: new Map([["m1", sync]]), preferWindows: true });
    expect(items.map((i) => i.kind)).toEqual(["clip"]);
  });

  it("changes nothing for a viewer without the copy", () => {
    const items = buildWatchItems(playlist, events, { syncByMatch: new Map(), preferWindows: true });
    expect(items.map((i) => i.kind)).toEqual(["clip"]);
  });
});
