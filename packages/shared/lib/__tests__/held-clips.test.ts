import { describe, expect, it } from "vitest";
import { unsendableClips, withUploadedFiles } from "../held-clips";
import type { PlaylistItem } from "../../types/match";

const clip = (matchId: string, eventId: number, r2Url?: string): PlaylistItem =>
  ({ type: "clip", matchId, eventId, ...(r2Url ? { r2Url } : {}) }) as PlaylistItem;
const text: PlaylistItem = { type: "text", id: "t1", text: "Half time", durationSeconds: 3 } as PlaylistItem;
const up = (matchId: string, eventId: number, r2Url: string) => ({ matchId, eventId, r2Url });

describe("withUploadedFiles", () => {
  it("gives each uploaded clip its file and leaves the rest alone", () => {
    const items = [clip("g1", 1), clip("g1", 2), text, clip("g2", 1, "old")];
    const out = withUploadedFiles(items, [up("g1", 2, "https://x/2")]);
    expect(out).toEqual([clip("g1", 1), clip("g1", 2, "https://x/2"), text, clip("g2", 1, "old")]);
  });

  it("returns the same array when nothing matches", () => {
    const items = [clip("g1", 1)];
    expect(withUploadedFiles(items, [up("g9", 9, "u")])).toBe(items);
  });
});

describe("unsendableClips", () => {
  const synced = { videoUrl: "/v.mp4", syncPoint: { syncVideoTime: 0, syncRealWorldTime: "2026-01-01T19:00:00Z" } };
  const games = new Map<string, { videoUrl?: string; syncPoint?: unknown }>([
    ["ok", synced],
    ["nosync", { videoUrl: "/v.mp4" }],
    ["novideo", { syncPoint: synced.syncPoint }],
  ]);
  const hasPlay = (key: string) => key !== "ok:404";

  it("nothing to say when every unsent clip can be cut", () => {
    expect(unsendableClips([clip("ok", 1), clip("nosync", 1, "done")], games, hasPlay)).toEqual({ count: 0, reason: null });
  });

  it("a game with no sync", () => {
    expect(unsendableClips([clip("ok", 1), clip("nosync", 1), clip("nosync", 2)], games, hasPlay)).toEqual({ count: 2, reason: "sync" });
  });

  it("a game whose video isn't here, or that wasn't read", () => {
    expect(unsendableClips([clip("novideo", 1), clip("gone", 1)], games, hasPlay)).toEqual({ count: 2, reason: "video" });
  });

  it("a play that couldn't be read", () => {
    expect(unsendableClips([clip("ok", 404)], games, hasPlay)).toEqual({ count: 1, reason: "play" });
  });

  it("sync is said first when reasons mix", () => {
    expect(unsendableClips([clip("novideo", 1), clip("nosync", 1), clip("ok", 404)], games, hasPlay)).toEqual({ count: 3, reason: "sync" });
  });
});
