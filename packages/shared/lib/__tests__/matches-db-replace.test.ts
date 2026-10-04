import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredMatch } from "../../types/match";
import { findMatchBySourceGame, saveMatch } from "../matches-db";

/** Chainable Supabase double that records (table, method, args) in call order. */
function mockClient(result: { data: unknown; error: null | { message: string } } = { data: null, error: null }) {
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];
  let table: string | undefined;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "upsert", "insert", "update", "delete", "eq", "in", "order", "limit", "maybeSingle", "single"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const from = vi.fn((t: string) => {
    table = t;
    return chain;
  });
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null }),
  };
  return { client: { from, auth, rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient, calls };
}

const match: StoredMatch = {
  id: "m1",
  title: "A vs B",
  date: "2026-10-04",
  homeTeam: { name: "A", color: "" },
  awayTeam: { name: "B", color: "" },
  homeRoster: [],
  awayRoster: [],
  events: [
    { eventId: 1, type: "2pt", subType: "", period: 1, gameClockTime: "", realWorldTime: "2026-10-04T12:00:00.000Z", isSuccessful: 1, player: null, eventTeam: null, qualifiers: [] },
  ],
  sourceGameId: "profixio:1",
  statsSessionId: "s-b",
};

describe("saveMatch replaceEvents", () => {
  it("deletes the match's events before upserting when the play-by-play source changed", async () => {
    const { client, calls } = mockClient();
    await saveMatch(client, match, { refreshEvents: true, replaceEvents: true });
    const order = calls.filter((c) => c.table === "play_by_play_events").map((c) => c.method);
    expect(order.indexOf("delete")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("delete")).toBeLessThan(order.indexOf("upsert"));
    const del = calls.find((c) => c.table === "play_by_play_events" && c.method === "eq");
    expect(del?.args).toEqual(["match_id", "m1"]);
  });

  it("never deletes on an ordinary import or re-import", async () => {
    const { client, calls } = mockClient();
    await saveMatch(client, match, { refreshEvents: true });
    expect(calls.some((c) => c.table === "play_by_play_events" && c.method === "delete")).toBe(false);
  });

  it("writes an explicit null stats_session_id when switching back to the league feed", async () => {
    const { client, calls } = mockClient();
    await saveMatch(client, { ...match, statsSessionId: null });
    const up = calls.find((c) => c.table === "matches" && c.method === "upsert")!;
    expect((up.args[0] as Record<string, unknown>).stats_session_id).toBeNull();
  });
});

describe("findMatchBySourceGame", () => {
  it("returns the stored stats session so the importer can tell a source switch", async () => {
    const { client } = mockClient({
      data: [{ id: "m1", title: "A vs B", video_url: null, sync_point: null, stats_session_id: "s-a" }],
      error: null,
    });
    const r = await findMatchBySourceGame(client, "profixio:1");
    expect(r).toMatchObject({ id: "m1", statsSessionId: "s-a" });
  });
});
