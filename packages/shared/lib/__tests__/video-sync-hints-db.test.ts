import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VideoFingerprint } from "../video-fingerprint";
import {
  findVideoSyncHints,
  pickBestHint,
  saveVideoSyncHint,
  type VideoSyncHintCandidate,
} from "../video-sync-hints-db";

const fp: VideoFingerprint = {
  version: 1,
  durationMs: 7112458,
  offsetsS: [30, 90, 180],
  hashes: ["00ff00ff00ff00ff", "0123456789abcdef", "fedcba9876543210"],
  key: "k".repeat(64),
};

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const client = { rpc } as unknown as SupabaseClient;
  return { client, rpc };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  tipoff_video_time: 1254,
  method: "confirmed",
  confidence: null,
  source_game_id: "profixio:32578145",
  is_mine: false,
  distances: [1, 2, 3],
  duration_delta_ms: 100,
  created_at: "2026-10-05T10:00:00Z",
  ...over,
});

describe("findVideoSyncHints", () => {
  it("calls the lookup RPC with the fingerprint and keeps only matching rows", async () => {
    const { client, rpc } = mockRpc({ data: [row(), row({ id: "2", distances: [30, 31, 32] })], error: null });
    const out = await findVideoSyncHints(client, fp, "profixio:32578145");
    expect(rpc).toHaveBeenCalledWith("find_video_sync_hints", {
      p_duration_ms: 7112458,
      p_hashes: fp.hashes,
      p_source_game_id: "profixio:32578145",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: row().id, tipoffVideoTime: 1254, method: "confirmed", distances: [1, 2, 3], durationDeltaMs: 100, isMine: false });
  });

  it("passes null when no game is known and throws on an RPC error", async () => {
    const { client, rpc } = mockRpc({ data: null, error: { message: "boom" } });
    await expect(findVideoSyncHints(client, fp)).rejects.toThrow(/boom/);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_source_game_id: null });
  });
});

describe("pickBestHint", () => {
  const cand = (over: Partial<VideoSyncHintCandidate> = {}): VideoSyncHintCandidate => ({
    id: Math.random().toString(36).slice(2),
    tipoffVideoTime: 1254,
    method: "auto",
    confidence: 0.9,
    sourceGameId: null,
    isMine: false,
    distances: [1, 2, 3],
    durationDeltaMs: 0,
    createdAt: "2026-10-05T10:00:00Z",
    ...over,
  });

  it("returns null when there is nothing", () => {
    expect(pickBestHint([])).toBeNull();
  });

  it("prefers a confirmed hint over any number of automatic ones", () => {
    const picked = pickBestHint([cand({ tipoffVideoTime: 1200 }), cand({ tipoffVideoTime: 1200 }), cand({ method: "confirmed", tipoffVideoTime: 1254 })]);
    expect(picked?.hint.tipoffVideoTime).toBe(1254);
    expect(picked?.agreement).toBe(1);
  });

  it("prefers the larger cluster of agreeing times, counting agreement within 1.5 s", () => {
    const picked = pickBestHint([cand({ tipoffVideoTime: 1253.6 }), cand({ tipoffVideoTime: 1254.4 }), cand({ tipoffVideoTime: 1300 })]);
    expect(picked?.hint.tipoffVideoTime).toBeCloseTo(1253.6, 1);
    expect(picked?.agreement).toBe(2);
  });

  it("ignores hints recorded for a different game but keeps unlinked ones", () => {
    const picked = pickBestHint(
      [cand({ sourceGameId: "profixio:1", tipoffVideoTime: 100 }), cand({ sourceGameId: null, tipoffVideoTime: 200 })],
      "profixio:2",
    );
    expect(picked?.hint.tipoffVideoTime).toBe(200);
  });

  it("breaks ties by the newest hint", () => {
    const picked = pickBestHint([cand({ tipoffVideoTime: 100, createdAt: "2026-01-01T00:00:00Z" }), cand({ tipoffVideoTime: 200, createdAt: "2026-02-01T00:00:00Z" })]);
    expect(picked?.hint.tipoffVideoTime).toBe(200);
  });
});

describe("saveVideoSyncHint", () => {
  it("upserts through the RPC and returns the row id", async () => {
    const { client, rpc } = mockRpc({ data: "22222222-2222-4222-8222-222222222222", error: null });
    const id = await saveVideoSyncHint(client, { fp, sourceGameId: "2857971", tipoffVideoTime: -15, method: "confirmed" });
    expect(id).toBe("22222222-2222-4222-8222-222222222222");
    expect(rpc).toHaveBeenCalledWith("upsert_video_sync_hint", {
      p_fingerprint_key: fp.key,
      p_duration_ms: 7112458,
      p_hashes: fp.hashes,
      p_source_game_id: "2857971",
      p_tipoff_video_time: -15,
      p_method: "confirmed",
      p_confidence: null,
    });
  });

  it("forwards the confidence of automatic hints and throws on error", async () => {
    const ok = mockRpc({ data: "x", error: null });
    await saveVideoSyncHint(ok.client, { fp, tipoffVideoTime: 335.7, method: "auto", confidence: 0.92 });
    expect(ok.rpc.mock.calls[0][1]).toMatchObject({ p_source_game_id: null, p_confidence: 0.92, p_method: "auto" });
    const bad = mockRpc({ data: null, error: { message: "invalid_fingerprint" } });
    await expect(saveVideoSyncHint(bad.client, { fp, tipoffVideoTime: 1, method: "auto" })).rejects.toThrow(/invalid_fingerprint/);
  });
});
