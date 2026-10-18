import { describe, expect, it } from "vitest";
import type { GameVideo } from "../game-videos-db";
import { canClipOnWeb, filterLibrary, libraryRowState, sortLibrary } from "../game-library";

const video = (over: Partial<GameVideo>): GameVideo => ({
  id: "v",
  matchId: "m",
  uploadedBy: "u",
  orgId: null,
  status: "ready",
  sourceKind: "unknown",
  sizeBytes: 1,
  durationSeconds: 9350,
  width: 1280,
  height: 720,
  fps: 25,
  sourceFingerprint: null,
  createdAt: "2026-10-18T10:00:00Z",
  readyAt: "2026-10-18T10:20:00Z",
  origin: "browser",
  sourceName: "game.mp4",
  sourceSizeBytes: 2,
  anchorKind: "tipoff",
  anchorLabel: null,
  anchorRealWorldTime: "2026-10-04T13:00:00Z",
  convertProgress: null,
  convertAttempts: 0,
  convertError: null,
  syncStatus: "not_found",
  suggestedTipoffSeconds: null,
  suggestedConfidence: null,
  ...over,
});
const synced = { syncPoint: { syncVideoTime: 300, syncRealWorldTime: "2026-10-04T13:00:00Z" } };
const unsynced = { syncPoint: undefined };

describe("libraryRowState", () => {
  it("reads every state a game can be in", () => {
    expect(libraryRowState(unsynced, null, null).kind).toBe("none");
    expect(libraryRowState(unsynced, video({ status: "uploading" }), { phase: "uploading", doneBytes: 50, totalBytes: 200 })).toMatchObject({ kind: "uploading", progress: 0.25 });
    expect(libraryRowState(unsynced, video({ status: "uploading" }), null).kind).toBe("interrupted");
    expect(libraryRowState(unsynced, video({ status: "converting" }), null)).toMatchObject({ kind: "converting", label: "Waiting to convert", progress: null });
    expect(libraryRowState(unsynced, video({ status: "converting", convertProgress: 0.42 }), null).label).toBe("Converting · 42%");
    expect(libraryRowState(unsynced, video({ status: "failed", convertError: "too_long" }), null).kind).toBe("failed");
    expect(libraryRowState(unsynced, video({}), null)).toMatchObject({ kind: "needs-sync", durationSeconds: 9350 });
    expect(libraryRowState(synced, video({ syncStatus: "applied" }), null).kind).toBe("check-sync");
    expect(libraryRowState(synced, video({ syncStatus: "confirmed" }), null)).toMatchObject({ kind: "ready", label: "In the cloud" });
    expect(libraryRowState(synced, video({ origin: "desktop", syncStatus: null }), null).kind).toBe("ready");
  });

  it("only a placed copy can be clipped on the web", () => {
    expect(canClipOnWeb(libraryRowState(synced, video({}), null))).toBe(true);
    expect(canClipOnWeb(libraryRowState(synced, video({ syncStatus: "applied" }), null))).toBe(true);
    expect(canClipOnWeb(libraryRowState(unsynced, video({}), null))).toBe(false);
    expect(canClipOnWeb(libraryRowState(unsynced, null, null))).toBe(false);
  });
});

describe("filterLibrary and sortLibrary", () => {
  const games = [
    { id: "a", title: "Fryshuset vs Malbas BBK", homeTeam: { name: "Fryshuset" }, awayTeam: { name: "Malbas BBK" }, date: "2026-10-18" },
    { id: "b", title: "Sollentuna vs Fryshuset", homeTeam: { name: "Sollentuna Basket" }, awayTeam: { name: "Fryshuset" }, date: "2026-10-14" },
    { id: "c", title: "Alvik vs Fryshuset", homeTeam: { name: "Alviks Basketbollklubb" }, awayTeam: { name: "Fryshuset" }, date: "2026-10-14" },
  ];

  it("matches every word against title and teams, without caring about case or accents", () => {
    expect(filterLibrary(games, "malbas").map((g) => g.id)).toEqual(["a"]);
    expect(filterLibrary(games, "FRYSHUSET sollentuna")).toHaveLength(1);
    expect(filterLibrary(games, "alviks")).toHaveLength(1);
    expect(filterLibrary(games, "  ")).toHaveLength(3);
    expect(filterLibrary(games, "huddinge")).toHaveLength(0);
  });

  it("puts the newest game first and keeps the given order for the same date", () => {
    expect(sortLibrary([games[1], games[2], games[0]]).map((g) => g.id)).toEqual(["a", "b", "c"]);
    expect(sortLibrary([games[2], games[1]]).map((g) => g.id)).toEqual(["c", "b"]);
  });
});
