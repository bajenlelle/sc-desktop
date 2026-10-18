import { describe, expect, it } from "vitest";
import { gameVideoBlock, gameVideoQuotaLabel, rowToGameVideo, type GameVideoRow } from "../game-videos-db";

describe("rowToGameVideo", () => {
  const row: GameVideoRow = {
    id: "v1",
    match_id: "m1",
    uploaded_by: "u1",
    org_id: null,
    status: "ready",
    source_kind: "unknown",
    size_bytes: "3000000000",
    duration_seconds: 9350.2,
    width: 1280,
    height: 720,
    source_fingerprint: "abc",
    created_at: "2026-10-19T10:00:00Z",
    ready_at: "2026-10-19T10:20:00Z",
  };

  it("maps columns and reads a bigint that arrived as text", () => {
    expect(rowToGameVideo(row)).toEqual({
      id: "v1",
      matchId: "m1",
      uploadedBy: "u1",
      orgId: null,
      status: "ready",
      sourceKind: "unknown",
      sizeBytes: 3_000_000_000,
      durationSeconds: 9350.2,
      width: 1280,
      height: 720,
      sourceFingerprint: "abc",
      createdAt: "2026-10-19T10:00:00Z",
      readyAt: "2026-10-19T10:20:00Z",
    });
    expect(rowToGameVideo({ ...row, size_bytes: null }).sizeBytes).toBeNull();
    expect(rowToGameVideo({ ...row, size_bytes: "many" }).sizeBytes).toBeNull();
  });
});

describe("the meter", () => {
  it("blocks when switched off, at the cap, or when the meter couldn't be read", () => {
    expect(gameVideoBlock(null)).toBe("unavailable");
    expect(gameVideoQuotaLabel(null)).toBe("Cloud copies aren't available right now");
    expect(gameVideoBlock({ enabled: false, tier: "pro", maxGames: 40, used: 0 })).toBe("disabled");
    expect(gameVideoBlock({ enabled: true, tier: "free", maxGames: 2, used: 2 })).toBe("limit_reached");
    expect(gameVideoBlock({ enabled: true, tier: "free", maxGames: 0, used: 0 })).toBe("limit_reached");
    expect(gameVideoBlock({ enabled: true, tier: "free", maxGames: 2, used: 1 })).toBeNull();
  });

  it("reads remaining-oriented, like the import meter", () => {
    expect(gameVideoQuotaLabel({ enabled: true, tier: "rookie", maxGames: 6, used: 2 })).toBe("4 of 6 cloud games left");
    expect(gameVideoQuotaLabel({ enabled: true, tier: "free", maxGames: 1, used: 1 })).toBe("0 of 1 cloud game left");
    expect(gameVideoQuotaLabel({ enabled: true, tier: "free", maxGames: 2, used: 5 })).toBe("0 of 2 cloud games left");
    expect(gameVideoQuotaLabel({ enabled: true, tier: "free", maxGames: 0, used: 0 })).toBe("Your plan doesn't include cloud copies");
    expect(gameVideoQuotaLabel({ enabled: false, tier: "pro", maxGames: 40, used: 3 })).toBe("Cloud copies are turned off right now");
  });
});
