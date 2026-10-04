import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatEvent, StatSession } from "../../types/stat-session";
import {
  eventToRow,
  finalizeStatSession,
  getStatSession,
  listStatSessionsForGames,
  parseStatSessionSummaries,
  rowToStatEvent,
  rowToStatSession,
  sessionToRow,
  upsertStatEvents,
  upsertStatSession,
} from "../stat-sessions-db";

const session: StatSession = {
  id: "11111111-1111-4111-8111-111111111111",
  createdBy: "u1",
  sourceGameId: "profixio:32578145",
  leagueId: "profixio-749-pojkar-u15",
  stageId: "1179119",
  homeName: "Fryshuset Svart",
  awayName: "Örebro",
  ourSide: 1,
  trackingMode: "ours",
  homeRoster: [{ jerseyNumber: "9", playerName: "Elsa Svensson" }],
  awayRoster: [],
  gameDate: "2026-10-03",
  tipoffAt: "2026-10-03T14:00:12.000Z",
  periodCount: 4,
  status: "live",
  finalizedAt: null,
  revision: 0,
  keeperLabel: "Anna L.",
  eventCount: 0,
  captureMeta: { recognizer: "ios-sfspeech", app: "1.0.0" },
};

const event: StatEvent = {
  sessionId: session.id,
  seq: 7,
  clientId: "c7",
  kind: "rebound",
  subType: "defensive",
  isSuccessful: 1,
  teamSide: 1,
  jersey: "9",
  playerName: "Elsa Svensson",
  period: 2,
  recordedAt: "2026-10-03T14:21:03.400Z",
  source: "live",
  linkedSeq: null,
  voidedAt: null,
  supersededBy: null,
};

/** Chainable Supabase double: records every call, resolves with `result`. */
function mockClient(result: { data: unknown; error: { message: string } | null } = { data: null, error: null }) {
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  const methods = ["select", "upsert", "insert", "update", "eq", "in", "order", "single", "maybeSingle"];
  let table: string | undefined;
  for (const m of methods) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return chain;
    });
  }
  // Awaiting the chain resolves with the result (PostgREST builders are thenable).
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const from = vi.fn((t: string) => {
    table = t;
    return chain;
  });
  const rpc = vi.fn().mockResolvedValue(result);
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }) };
  return { client: { from, rpc, auth } as unknown as SupabaseClient, calls, rpc, from };
}

describe("row mapping", () => {
  it("round-trips a session through snake_case", () => {
    const row = sessionToRow(session);
    expect(row).toMatchObject({
      id: session.id,
      created_by: "u1",
      source_game_id: "profixio:32578145",
      league_id: "profixio-749-pojkar-u15",
      stage_id: "1179119",
      home_name: "Fryshuset Svart",
      away_name: "Örebro",
      our_side: 1,
      tracking_mode: "ours",
      game_date: "2026-10-03",
      tipoff_at: "2026-10-03T14:00:12.000Z",
      period_count: 4,
      status: "live",
      keeper_label: "Anna L.",
      capture_meta: { recognizer: "ios-sfspeech", app: "1.0.0" },
    });
    expect(rowToStatSession({ ...row, finalized_at: null, revision: 0, event_count: 0, hidden_at: null })).toEqual(session);
  });

  it("round-trips an event and keeps nulls as nulls", () => {
    const row = eventToRow(event);
    expect(row).toEqual({
      session_id: session.id,
      seq: 7,
      client_id: "c7",
      kind: "rebound",
      sub_type: "defensive",
      is_successful: 1,
      team_side: 1,
      jersey: "9",
      player_name: "Elsa Svensson",
      period: 2,
      recorded_at: "2026-10-03T14:21:03.400Z",
      source: "live",
      linked_seq: null,
      voided_at: null,
      superseded_by: null,
    });
    expect(rowToStatEvent(row)).toEqual(event);
  });

  it("rejects malformed session rows instead of producing half objects", () => {
    expect(rowToStatSession({ id: "x" })).toBeNull();
    expect(rowToStatSession({ ...sessionToRow(session), our_side: 3 })).toBeNull();
  });
});

describe("writes", () => {
  it("upserts the session row on id", async () => {
    const { client, calls } = mockClient();
    await upsertStatSession(client, session);
    const up = calls.find((c) => c.method === "upsert")!;
    expect(up.table).toBe("stat_sessions");
    expect(up.args[0]).toMatchObject({ id: session.id, home_name: "Fryshuset Svart" });
    expect(up.args[1]).toEqual({ onConflict: "id" });
  });

  it("upserts events on (session_id, seq) and skips the call for an empty batch", async () => {
    const { client, calls } = mockClient();
    await upsertStatEvents(client, [event]);
    const up = calls.find((c) => c.method === "upsert")!;
    expect(up.table).toBe("stat_events");
    expect(up.args[0]).toEqual([eventToRow(event)]);
    expect(up.args[1]).toEqual({ onConflict: "session_id,seq" });

    const empty = mockClient();
    await upsertStatEvents(empty.client, []);
    expect(empty.from).not.toHaveBeenCalled();
  });

  it("surfaces database errors", async () => {
    const { client } = mockClient({ data: null, error: { message: "boom" } });
    await expect(upsertStatSession(client, session)).rejects.toThrow(/boom/);
  });

  it("finalizes through the RPC with the session id", async () => {
    const { client, rpc } = mockClient({ data: { revision: 1, event_count: 12 }, error: null });
    const r = await finalizeStatSession(client, session.id);
    expect(rpc).toHaveBeenCalledWith("finalize_stat_session", { p_session_id: session.id });
    expect(r).toEqual({ revision: 1, eventCount: 12 });
  });
});

describe("reads", () => {
  it("loads a session with its events ordered by seq", async () => {
    const sessionRow = { ...sessionToRow(session), finalized_at: null, revision: 0, event_count: 0, hidden_at: null };
    const { client, calls } = mockClient({ data: sessionRow, error: null });
    // Second call (events) returns the same double; the mapper tolerates a non-array by treating it as empty.
    const r = await getStatSession(client, session.id);
    expect(r?.session).toEqual(session);
    expect(calls.some((c) => c.table === "stat_events" && c.method === "order")).toBe(true);
  });

  it("groups the badge RPC's rows by game id", async () => {
    const rows = [
      { source_game_id: "profixio:1", id: "s1", keeper_label: "Anna L.", tracking_mode: "ours", our_side: 1, event_count: 231, has_tipoff: true, finalized_at: "2026-10-03T18:42:00Z", revision: 2, home_name: "A", away_name: "B" },
      { source_game_id: "profixio:1", id: "s2", keeper_label: "Anonymous keeper", tracking_mode: "both", our_side: 2, event_count: 90, has_tipoff: false, finalized_at: "2026-10-03T19:00:00Z", revision: 1, home_name: "A", away_name: "B" },
      { source_game_id: "2668882", id: "s3", keeper_label: "Bo", tracking_mode: "ours", our_side: 1, event_count: 10, has_tipoff: true, finalized_at: "2026-10-04T10:00:00Z", revision: 1, home_name: "C", away_name: "D" },
    ];
    const { client, rpc } = mockClient({ data: rows, error: null });
    const byGame = await listStatSessionsForGames(client, ["profixio:1", "2668882", "none"]);
    expect(rpc).toHaveBeenCalledWith("list_stat_sessions_for_games", { p_game_ids: ["profixio:1", "2668882", "none"] });
    expect([...byGame.keys()]).toEqual(["profixio:1", "2668882"]);
    expect(byGame.get("profixio:1")!.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(byGame.get("profixio:1")![0]).toEqual({
      id: "s1",
      sourceGameId: "profixio:1",
      keeperLabel: "Anna L.",
      trackingMode: "ours",
      ourSide: 1,
      eventCount: 231,
      hasTipoff: true,
      finalizedAt: "2026-10-03T18:42:00Z",
      revision: 2,
      homeName: "A",
      awayName: "B",
    });
  });

  it("skips malformed summary rows and returns an empty map for a non-array", () => {
    expect(parseStatSessionSummaries(null).size).toBe(0);
    expect(parseStatSessionSummaries([{ id: "s1" }]).size).toBe(0);
  });

  it("asks for nothing when there are no game ids", async () => {
    const { client, rpc } = mockClient();
    const r = await listStatSessionsForGames(client, []);
    expect(r.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
