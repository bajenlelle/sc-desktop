import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { locateOverlay, readFrames } from "../tipoff-detect-client";

function mockClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  const client = { functions: { invoke } } as unknown as SupabaseClient;
  return { client, invoke };
}

const frames = [{ jpegBase64: "AAAA" }, { jpegBase64: "BBBB" }];

describe("readFrames", () => {
  it("posts the read_frames action with the frames and returns the readings", async () => {
    const data = { readings: [{ index: 0, clockVisible: true, clock: "10:00", clockRunning: null, period: 1, state: "lineup", jumpBall: true }], usage: { model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 5 } };
    const { client, invoke } = mockClient({ data, error: null });
    const res = await readFrames(client, { frames, view: "overlay", periodLengthS: 600 });
    expect(invoke).toHaveBeenCalledWith("tipoff-detect", { body: { action: "read_frames", view: "overlay", periodLengthS: 600, frames } });
    expect(res).toEqual({ ok: true, data });
  });

  it("surfaces the snake token from the function's error body", async () => {
    const error = { context: { json: async () => ({ error: "too_many_frames" }) } };
    const { client } = mockClient({ data: null, error });
    expect(await readFrames(client, { frames, view: "whole", periodLengthS: 600 })).toEqual({ ok: false, error: "too_many_frames" });
  });

  it("falls back to request_failed when there is no readable body", async () => {
    const { client } = mockClient({ data: null, error: new Error("network") });
    expect(await readFrames(client, { frames, view: "whole", periodLengthS: 600 })).toEqual({ ok: false, error: "request_failed" });
  });
});

describe("locateOverlay", () => {
  it("posts the locate_overlay action", async () => {
    const data = { found: true, box: { x: 0.2, y: 0.84, w: 0.6, h: 0.16 }, confidence: 0.8, elements: ["game_clock"], usage: { model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 5 } };
    const { client, invoke } = mockClient({ data, error: null });
    const res = await locateOverlay(client, { frames });
    expect(invoke).toHaveBeenCalledWith("tipoff-detect", { body: { action: "locate_overlay", frames } });
    expect(res).toEqual({ ok: true, data });
  });
});
