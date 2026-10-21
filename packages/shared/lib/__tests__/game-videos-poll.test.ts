import { describe, expect, it } from "vitest";
import {
  GAME_VIDEO_LIST_POLL_MS,
  GAME_VIDEO_LIST_SLOW_POLL_MS,
  gameVideoListPollMs,
  type GameVideo,
} from "../game-videos-db";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function video(partial: Partial<GameVideo>): GameVideo {
  return {
    id: "v1",
    matchId: "m1",
    uploadedBy: "u1",
    orgId: null,
    status: "ready",
    sourceKind: "unknown",
    sizeBytes: null,
    durationSeconds: null,
    width: null,
    height: null,
    fps: null,
    sourceFingerprint: null,
    createdAt: minutesAgo(5),
    readyAt: minutesAgo(1),
    origin: "browser",
    sourceName: null,
    sourceSizeBytes: null,
    anchorKind: null,
    anchorLabel: null,
    anchorRealWorldTime: null,
    convertProgress: null,
    convertAttempts: 0,
    convertError: null,
    syncStatus: null,
    suggestedTipoffSeconds: null,
    suggestedConfidence: null,
    ...partial,
  } as GameVideo;
}

describe("gameVideoListPollMs", () => {
  it("doesn't poll when nothing is settling", () => {
    expect(gameVideoListPollMs([], NOW)).toBeNull();
    expect(gameVideoListPollMs([video({ status: "ready", syncStatus: "confirmed" as GameVideo["syncStatus"] })], NOW)).toBeNull();
  });

  it("polls every ten seconds while a fresh conversion runs", () => {
    expect(gameVideoListPollMs([video({ status: "converting", createdAt: minutesAgo(3), readyAt: null })], NOW)).toBe(GAME_VIDEO_LIST_POLL_MS);
  });

  it("polls every ten seconds right after a copy is ready and its tip-off is pending", () => {
    expect(gameVideoListPollMs([video({ status: "ready", syncStatus: "pending", readyAt: minutesAgo(2) })], NOW)).toBe(GAME_VIDEO_LIST_POLL_MS);
  });

  it("slows to once a minute when every settling row has been at it a while", () => {
    expect(
      gameVideoListPollMs(
        [
          video({ status: "converting", createdAt: minutesAgo(45), readyAt: null }),
          video({ id: "v2", status: "ready", syncStatus: "pending", readyAt: minutesAgo(30) }),
        ],
        NOW,
      ),
    ).toBe(GAME_VIDEO_LIST_SLOW_POLL_MS);
  });

  it("keeps the fast pace while any one settling row is fresh", () => {
    expect(
      gameVideoListPollMs(
        [
          video({ status: "converting", createdAt: minutesAgo(45), readyAt: null }),
          video({ id: "v2", status: "converting", createdAt: minutesAgo(1), readyAt: null }),
        ],
        NOW,
      ),
    ).toBe(GAME_VIDEO_LIST_POLL_MS);
  });

  it("treats an unreadable timestamp as fresh", () => {
    expect(gameVideoListPollMs([video({ status: "converting", createdAt: "not a date", readyAt: null })], NOW)).toBe(GAME_VIDEO_LIST_POLL_MS);
  });
});
