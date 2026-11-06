import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import { FIRST_FRAME_SECONDS, reportClipEffects, reportClipSource, reportFirstFrame, reportFrameKey, reportPosterDrawing } from "../report-clip-source";

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

describe("reportClipEffects", () => {
  const spot = { kind: "spotlight" as const, id: "sp", at: { x: 0.5, y: 0.5 }, r: 0.1 };
  const item = {
    drawings: [
      { id: "early", t: 150.05, hold: 4, shapes: [spot] }, // within 0.1 s of the start
      { id: "b", t: 160, hold: 3, shapes: [spot] },
      { id: "a", t: 155, hold: 4, shapes: [spot] },
      { id: "late", t: 162.95, hold: 4, shapes: [spot] }, // within 0.1 s of the end
    ],
    slowMotion: [
      { id: "w1", t: 149, length: 2, rate: 0.5 as const }, // starts before the clip
      { id: "w2", t: 162.5, length: 2, rate: 0.25 as const }, // runs past its end
      { id: "w3", t: 162.95, length: 1, rate: 0.5 as const }, // under 0.1 s of it inside
      { id: "w4", t: 170, length: 1, rate: 0.5 as const }, // after it
    ],
  };

  it("keeps the game video's own time for a local clip, inside its window as the editor and the export do", () => {
    const fx = reportClipEffects(item, { kind: "local", path, start: 150, end: 163 });
    expect(fx.drawings).toEqual([
      { id: "a", at: 155, hold: 4, shapes: [spot] },
      { id: "b", at: 160, hold: 3, shapes: [spot] },
    ]);
    expect(fx.slows).toEqual([
      { id: "w1", at: 150, length: 1, rate: 0.5 },
      { id: "w2", at: 162.5, length: 0.5, rate: 0.25 },
    ]);
  });

  it("takes the uploaded copy's own time and window, as the players do", () => {
    // The copy starts 152 s into the game's video (its key's _s152.0) and runs at most 8 + 4 s.
    const fx = reportClipEffects(item, { kind: "shared", url });
    expect(fx.drawings.map((d) => [d.id, d.at])).toEqual([
      ["a", 3],
      ["b", 8],
      ["late", 10.95],
    ]);
    expect(fx.slows.map((s) => [s.id, s.at, s.length])).toEqual([
      ["w2", 10.5, 1.5],
      ["w3", 10.95, 1],
    ]);
  });

  it("has nothing for a clip that can't play or has no effects", () => {
    expect(reportClipEffects(item, { kind: "none", reason: "no_video" })).toEqual({ drawings: [], slows: [] });
    expect(reportClipEffects({}, { kind: "local", path, start: 150, end: 163 })).toEqual({ drawings: [], slows: [] });
    expect(reportClipEffects(item, { kind: "shared", url: "https://media.scoutable.se/clips/m1/42_pre8.0_post4.0.mp4" })).toEqual({ drawings: [], slows: [] });
  });
});

describe("reportFirstFrame", () => {
  it("takes the game video's frame just after the clip starts", () => {
    expect(FIRST_FRAME_SECONDS).toBe(0.3);
    expect(reportFirstFrame({ kind: "local", path, start: 150, end: 163 })).toEqual({ kind: "local", path, at: 150.3 });
  });

  it("takes the middle of a window too short for that", () => {
    expect(reportFirstFrame({ kind: "local", path, start: 10, end: 10.4 })).toEqual({ kind: "local", path, at: 10.2 });
  });

  it("takes the uploaded copy's frame just after its fade-in from black", () => {
    expect(reportFirstFrame({ kind: "shared", url })).toEqual({ kind: "shared", url, at: 0.3 });
  });

  it("has nothing for a clip that can't play", () => {
    expect(reportFirstFrame({ kind: "none", reason: "no_video" })).toBeNull();
  });
});

describe("reportFrameKey", () => {
  it("changes with the file and with where the clip starts in it", () => {
    const a = reportFrameKey({ kind: "local", path, at: 150.3 });
    expect(reportFrameKey({ kind: "local", path, at: 150.3 })).toBe(a);
    expect(reportFrameKey({ kind: "local", path, at: 151.3 })).not.toBe(a);
    expect(reportFrameKey({ kind: "local", path: "/Users/coach/Movies/other.mp4", at: 150.3 })).not.toBe(a);
    const b = reportFrameKey({ kind: "shared", url, at: 0.3 });
    expect(b).not.toBe(a);
    expect(reportFrameKey({ kind: "shared", url: url.replace("_s152.0", "_s153.0"), at: 0.3 })).not.toBe(b);
  });
});

describe("reportPosterDrawing", () => {
  // Shipped with a 5 s pre-roll: the file starts 5 s before the play (at 100) and runs 3 s past it.
  const shipped = "https://media.scoutable.se/clips/m1/42_pre5.0_post3.0_s95.0.mp4";
  const spot = (x: number) => [{ kind: "spotlight" as const, id: `s${x}`, at: { x, y: 0.5 }, r: 0.1 }];

  it("burns in the first drawing the clip's file shows, at the frame it was drawn on", () => {
    const item = {
      r2Url: shipped,
      drawings: [
        { id: "before", t: 93, hold: 4, shapes: spot(0.1) }, // before the file starts: the page never shows it
        { id: "second", t: 99.5, hold: 4, shapes: spot(0.3) },
        { id: "first", t: 97.123, hold: 4, shapes: spot(0.2) },
        { id: "after", t: 104, hold: 4, shapes: spot(0.4) }, // past the file's end
      ],
    };
    expect(reportPosterDrawing(item)).toEqual({ t: 97.123, shapes: spot(0.2) });
  });

  it("has none when the file shows no drawing, doesn't say where it starts, or isn't there", () => {
    const outside = [{ id: "before", t: 93, hold: 4, shapes: spot(0.1) }, { id: "after", t: 104, hold: 4, shapes: spot(0.4) }];
    expect(reportPosterDrawing({ r2Url: shipped, drawings: outside })).toBeNull();
    const inside = [{ id: "in", t: 97, hold: 4, shapes: spot(0.2) }];
    expect(reportPosterDrawing({ r2Url: "https://media.scoutable.se/clips/m1/42_pre5.0_post3.0.mp4", drawings: inside })).toBeNull();
    expect(reportPosterDrawing({ drawings: inside })).toBeNull();
    expect(reportPosterDrawing({ r2Url: shipped })).toBeNull();
  });
});
