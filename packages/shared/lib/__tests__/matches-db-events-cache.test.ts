import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteMatch, invalidateMatchEvents, listEventsForMatches } from "../matches-db";

function eventRow(matchId: string, eventId: number) {
  return { match_id: matchId, event_id: eventId, type: "2pt", sub_type: null, period: 1, game_clock_time: "10:00", real_world_time: null, is_successful: 1 };
}

/**
 * Double for `from("matches").select("id, play_by_play_events(*)").in("id", ids)`
 * (and the two deletes deleteMatch makes). `visible` is what RLS returns
 * (plays 1..n per game; mutate it to share more); `fail` makes the next read
 * fail; `gate` holds reads until released; `afterRead` runs after each read.
 */
function mockClient(opts: { uid?: string | null; visible?: Record<string, number> } = {}) {
  const reads: string[][] = [];
  const state = { fail: false, gate: null as Promise<void> | null, afterRead: null as (() => void) | null };
  const uid = opts.uid === undefined ? "coach" : opts.uid;
  const visible = opts.visible ?? { m1: 2, m2: 1, m3: 3 };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }),
    },
    from() {
      const b = {
        select: () => b,
        delete: () => b,
        eq: () => Promise.resolve({ error: null }),
        in: async (_col: string, ids: string[]) => {
          reads.push([...ids]);
          if (state.gate) await state.gate;
          if (state.fail) return { data: null, error: { message: "boom" } };
          const data = ids
            .filter((id) => id in visible)
            .map((id) => ({ id, play_by_play_events: Array.from({ length: visible[id] }, (_, i) => eventRow(id, i + 1)) }));
          state.afterRead?.();
          return { data, error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, reads, state };
}

describe("listEventsForMatches cache", () => {
  beforeEach(() => invalidateMatchEvents());
  afterEach(() => vi.useRealTimers());

  it("reads a game again once its entry is an hour old", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const { client, reads } = mockClient();
    await listEventsForMatches(client, ["m1"]);
    vi.setSystemTime(new Date("2026-10-21T12:59:00Z"));
    await listEventsForMatches(client, ["m1"]);
    vi.setSystemTime(new Date("2026-10-21T13:01:00Z"));
    await listEventsForMatches(client, ["m1"]);
    expect(reads).toEqual([["m1"], ["m1"]]);
  });

  it("reads a game once per session and hands back the same arrays", async () => {
    const { client, reads } = mockClient();
    const first = await listEventsForMatches(client, ["m1", "m2"]);
    const second = await listEventsForMatches(client, ["m2", "m1"]);
    expect(reads).toEqual([["m1", "m2"]]);
    expect(second.m1).toBe(first.m1);
    expect(first.m1).toHaveLength(2);
    expect(first.m1[0].eventId).toBe(1);
  });

  it("fetches only the games it hasn't got", async () => {
    const { client, reads } = mockClient();
    await listEventsForMatches(client, ["m1"]);
    const out = await listEventsForMatches(client, ["m1", "m3"]);
    expect(reads).toEqual([["m1"], ["m3"]]);
    expect(Object.keys(out).sort()).toEqual(["m1", "m3"]);
  });

  it("shares one read between callers asking at the same time", async () => {
    const { client, reads, state } = mockClient();
    let release!: () => void;
    state.gate = new Promise((r) => (release = r));
    const a = listEventsForMatches(client, ["m1", "m2"]);
    const b = listEventsForMatches(client, ["m2"]);
    await Promise.resolve();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(reads).toEqual([["m1", "m2"]]);
    expect(rb.m2).toBe(ra.m2);
  });

  it("never serves one account's plays to another", async () => {
    const coach = mockClient({ uid: "coach" });
    const player = mockClient({ uid: "player" });
    await listEventsForMatches(coach.client, ["m1"]);
    await listEventsForMatches(player.client, ["m1"]);
    expect(player.reads).toEqual([["m1"]]);
  });

  it("doesn't cache without a session", async () => {
    const { client, reads } = mockClient({ uid: null });
    await listEventsForMatches(client, ["m1"]);
    await listEventsForMatches(client, ["m1"]);
    expect(reads).toEqual([["m1"], ["m1"]]);
  });

  it("returns nothing for a failed read and asks again next time", async () => {
    const { client, reads, state } = mockClient();
    state.fail = true;
    expect(await listEventsForMatches(client, ["m1"])).toEqual({});
    state.fail = false;
    const out = await listEventsForMatches(client, ["m1"]);
    expect(out.m1).toHaveLength(2);
    expect(reads).toEqual([["m1"], ["m1"]]);
  });

  it("asks again for a game RLS didn't return", async () => {
    const { client, reads } = mockClient({ visible: { m1: 1 } });
    const out = await listEventsForMatches(client, ["m1", "hidden"]);
    expect(Object.keys(out)).toEqual(["m1"]);
    await listEventsForMatches(client, ["m1", "hidden"]);
    expect(reads).toEqual([["m1", "hidden"], ["hidden"]]);
  });

  it("reads a game again after it is invalidated or deleted", async () => {
    const { client, reads } = mockClient();
    await listEventsForMatches(client, ["m1", "m2"]);
    invalidateMatchEvents(["m1"]);
    await listEventsForMatches(client, ["m1", "m2"]);
    await deleteMatch(client, "m2");
    await listEventsForMatches(client, ["m1", "m2"]);
    expect(reads).toEqual([["m1", "m2"], ["m1"], ["m2"]]);
  });

  it("reads a game again when a newer share needs a play its entry lacks", async () => {
    // A player's entry holds only the plays shared with them when it was read.
    const visible = { m1: 3 };
    const { client, reads } = mockClient({ uid: "player", visible });
    await listEventsForMatches(client, ["m1"], { required: new Map([["m1", new Set([1, 2])]]) });
    visible.m1 = 5; // a second playlist from the game is shared
    const out = await listEventsForMatches(client, ["m1"], { required: new Map([["m1", new Set([1, 2, 4])]]) });
    expect(out.m1.map((e) => e.eventId)).toEqual([1, 2, 3, 4, 5]);
    // The fresh entry covers it from now on.
    await listEventsForMatches(client, ["m1"], { required: new Map([["m1", new Set([4, 5])]]) });
    expect(reads).toEqual([["m1"], ["m1"]]);
  });

  it("serves the entry while it holds every play asked for", async () => {
    const { client, reads } = mockClient({ visible: { m1: 3, m2: 1 } });
    await listEventsForMatches(client, ["m1", "m2"]);
    await listEventsForMatches(client, ["m1", "m2"], {
      required: new Map([["m1", new Set([1, 3])], ["m2", new Set<number>()]]),
    });
    expect(reads).toEqual([["m1", "m2"]]);
  });

  it("re-reads only the stale game of several", async () => {
    const visible = { m1: 2, m2: 2 };
    const { client, reads } = mockClient({ uid: "player", visible });
    await listEventsForMatches(client, ["m1", "m2"]);
    visible.m2 = 3;
    const out = await listEventsForMatches(client, ["m1", "m2"], {
      required: new Map([["m1", new Set([2])], ["m2", new Set([3])]]),
    });
    expect(reads).toEqual([["m1", "m2"], ["m2"]]);
    expect(out.m1).toHaveLength(2);
    expect(out.m2).toHaveLength(3);
  });

  it("asks again after a shared read that came back without a needed play", async () => {
    const visible = { m1: 2 };
    const { client, reads, state } = mockClient({ uid: "player", visible });
    let release!: () => void;
    state.gate = new Promise((r) => (release = r));
    // The share lands after the first read was answered.
    state.afterRead = () => {
      visible.m1 = 3;
      state.afterRead = null;
    };
    const a = listEventsForMatches(client, ["m1"]);
    const b = listEventsForMatches(client, ["m1"], { required: new Map([["m1", new Set([3])]]) });
    await Promise.resolve();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.m1).toHaveLength(2);
    expect(rb.m1).toHaveLength(3);
    expect(reads).toEqual([["m1"], ["m1"]]);
  });

  it("returns {} for no ids without a read", async () => {
    const { client, reads } = mockClient();
    expect(await listEventsForMatches(client, [])).toEqual({});
    expect(reads).toEqual([]);
  });
});
