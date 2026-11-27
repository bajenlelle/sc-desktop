import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { cxAt } from "../crop-path";
import { frameHighlight, framingContext, framingTarget } from "../highlight-frame-client";
import type { HighlightCandidate } from "../highlight-picks";

const TEAMS = { home: "Eskilstuna Basket", away: "Fryshuset Basketbollklubb", league: "Superettan Herr" };

const layup: PlayByPlayEvent = {
  eventId: 7,
  type: "2pt",
  subType: "layup",
  period: 1,
  gameClockTime: "05:43",
  realWorldTime: "2026-10-21T17:12:00.000Z",
  isSuccessful: 1,
  player: { playerId: 78001, pno: 78, firstName: "Pedro", familyName: "Lelo Hök", teamNumber: 2 },
  eventTeam: null,
  qualifiers: [],
  scoreHome: 13,
  scoreAway: 15,
};
const candidate: HighlightCandidate = {
  key: "m1:7", matchId: "m1", kind: "two", events: [layup], anchor: layup, andOne: false, clutch: false, goAhead: false, score: 4,
};

function supabaseReturning(result: { data?: unknown; error?: unknown }) {
  const invoke = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

describe("prompts", () => {
  it("names the player with number and team", () => {
    expect(framingTarget(layup, TEAMS)).toBe("#78 Pedro Lelo Hök of Fryshuset Basketbollklubb");
  });

  it("states the teams and the clip's play-by-play", () => {
    expect(framingContext(candidate, TEAMS)).toBe(
      "Eskilstuna Basket (home) vs Fryshuset Basketbollklubb (away), Superettan Herr. Play-by-play for this clip: Q1 05:43: 2PT Made by #78 Pedro Lelo Hök (score 13-15).",
    );
  });
});

describe("frameHighlight", () => {
  const observation = {
    frames: Array.from({ length: 13 }, (_, i) => ({ image: i + 1, x: 0.66 - i * 0.04, cameraCut: false })),
    releaseImage: 10,
    rimX: 0.265,
    madeImage: 11,
    identity: "likely",
    note: "",
  };

  it("samples, asks and returns keyframes, a tighter window and the check flag", async () => {
    const { client, invoke } = supabaseReturning({ data: { observation, usage: { model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1, latencyMs: 1, fallback: false } } });
    const grab = vi.fn(async (times: number[]) => times.map(() => "/9j/AAAA"));
    const res = await frameHighlight({ supabase: client, grab }, candidate, { start: 773.4, end: 776.4 }, TEAMS, (1080 * 9) / 16 / 1920);
    expect(grab).toHaveBeenCalledWith([773.4, 773.65, 773.9, 774.15, 774.4, 774.65, 774.9, 775.15, 775.4, 775.65, 775.9, 776.15, 776.4].map((t) => expect.closeTo(t, 6)));
    const body = invoke.mock.calls[0][1].body;
    expect(body.frames).toHaveLength(13);
    expect(body.shot).toBe(true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(cxAt(res.data.keyframes, 776.4)).toBeCloseTo(0.265, 1);
    expect(res.data.window?.start).toBeCloseTo(773.4, 5);
    expect(res.data.window?.end).toBeCloseTo(776.4, 5);
    expect(res.data.check).toBe(false);
  });

  it("passes the function's error token through", async () => {
    const ctx = { json: async () => ({ error: "too_many_requests" }) };
    const { client } = supabaseReturning({ error: { context: ctx } });
    const res = await frameHighlight({ supabase: client, grab: async (t) => t.map(() => "/9j/AAAA") }, candidate, { start: 0, end: 1 }, TEAMS, 0.3);
    expect(res).toEqual({ ok: false, error: "too_many_requests" });
  });

  it("stops when frames are missing", async () => {
    const { client, invoke } = supabaseReturning({});
    const res = await frameHighlight({ supabase: client, grab: async () => [] }, candidate, { start: 0, end: 1 }, TEAMS, 0.3);
    expect(res).toEqual({ ok: false, error: "grab_failed" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
