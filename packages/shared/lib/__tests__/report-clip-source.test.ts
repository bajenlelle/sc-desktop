import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import { reportClipSource } from "../report-clip-source";

const sync: SyncPoint = { syncVideoTime: 100, syncRealWorldTime: "2026-10-04T18:00:00Z" };
const path = "/Users/coach/Movies/game.mp4";
const url = "https://media.scoutable.se/clips/m1/42_pre8.0_post4.0_s152.0.mp4";
const event = { realWorldTime: "2026-10-04T18:01:00Z" };

describe("reportClipSource", () => {
  it("plays the game's own video around the play", () => {
    expect(
      reportClipSource({
        item: { preRollOffset: -2, postRollOffset: 1 },
        event,
        videoPath: path,
        syncPoint: sync,
        preRoll: 10,
        postRoll: 3,
      }),
    ).toEqual({ kind: "local", path, start: 152, end: 164 });
  });

  it("starts at 0 when the play is early", () => {
    expect(
      reportClipSource({
        item: {},
        event: { realWorldTime: "2026-10-04T17:58:35Z" },
        videoPath: path,
        syncPoint: sync,
        preRoll: 10,
        postRoll: 3,
      }),
    ).toEqual({ kind: "local", path, start: 5, end: 18 });
    expect(
      reportClipSource({
        item: {},
        event: { realWorldTime: "2026-10-04T17:58:25Z" },
        videoPath: path,
        syncPoint: sync,
        preRoll: 10,
        postRoll: 3,
      }),
    ).toEqual({ kind: "local", path, start: 0, end: 8 });
  });

  it("plays the uploaded copy when the video isn't here", () => {
    expect(
      reportClipSource({ item: { r2Url: url }, event, videoPath: null, syncPoint: sync, preRoll: 10, postRoll: 3 }),
    ).toEqual({ kind: "shared", url });
  });

  it("prefers the local video over the uploaded copy", () => {
    expect(
      reportClipSource({ item: { r2Url: url }, event, videoPath: path, syncPoint: sync, preRoll: 10, postRoll: 3 }),
    ).toEqual({ kind: "local", path, start: 150, end: 163 });
  });

  it("says the video isn't here", () => {
    expect(reportClipSource({ item: {}, event, videoPath: null, syncPoint: sync, preRoll: 10, postRoll: 3 })).toEqual({
      kind: "none",
      reason: "no_video",
    });
    expect(reportClipSource({ item: {}, event, videoPath: null, syncPoint: null, preRoll: 10, postRoll: 3 })).toEqual({
      kind: "none",
      reason: "no_video",
    });
  });

  it("says the game isn't synced", () => {
    expect(reportClipSource({ item: {}, event, videoPath: path, syncPoint: null, preRoll: 10, postRoll: 3 })).toEqual({
      kind: "none",
      reason: "no_sync",
    });
    expect(reportClipSource({ item: {}, event: {}, videoPath: path, syncPoint: sync, preRoll: 10, postRoll: 3 })).toEqual({
      kind: "none",
      reason: "no_sync",
    });
    expect(
      reportClipSource({ item: {}, event: { realWorldTime: null }, videoPath: path, syncPoint: sync, preRoll: 10, postRoll: 3 }),
    ).toEqual({ kind: "none", reason: "no_sync" });
  });

  it("an unsynced game with an uploaded copy plays the copy", () => {
    expect(
      reportClipSource({ item: { r2Url: url }, event, videoPath: path, syncPoint: null, preRoll: 10, postRoll: 3 }),
    ).toEqual({ kind: "shared", url });
    expect(
      reportClipSource({ item: { r2Url: url }, event: {}, videoPath: path, syncPoint: sync, preRoll: 10, postRoll: 3 }),
    ).toEqual({ kind: "shared", url });
  });
});
