import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bulkAssign, listAssignmentsForMatches, setClipAssignments } from "../labels-db";

function row(matchId: string, eventId: number, labelId: string) {
  return { user_id: "u1", org_id: "org", match_id: matchId, event_id: eventId, label_id: labelId, assigned_at: "2026-10-21T00:00:00Z" };
}

type Chain = { eq: [string, unknown][]; in: [string, unknown[]][]; is: [string, unknown][] };

/**
 * Records every chain the lib builds — reads (select), deletes and insert
 * payloads — and answers each read with `rows` (or `error`).
 */
function client(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const reads: Chain[] = [];
  const deletes: Chain[] = [];
  const inserts: Record<string, unknown>[][] = [];
  const c = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from() {
      const chain: Chain = { eq: [], in: [], is: [] };
      const b: Record<string, unknown> = {
        select: () => (reads.push(chain), b),
        delete: () => (deletes.push(chain), b),
        insert: (payload: Record<string, unknown>[]) => (inserts.push(payload), Promise.resolve({ error: null })),
        eq: (col: string, v: unknown) => (chain.eq.push([col, v]), b),
        in: (col: string, v: unknown[]) => (chain.in.push([col, v]), b),
        is: (col: string, v: unknown) => (chain.is.push([col, v]), b),
        then: (r: (x: unknown) => unknown) => Promise.resolve({ data: error ? null : rows, error }).then(r),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { c, reads, deletes, inserts };
}

/** A label is on the clip itself: no chain may narrow it to a playlist. */
function expectNoScope(chain: Chain) {
  expect(chain.is).toEqual([]);
  expect(chain.eq.map(([col]) => col)).not.toContain("playlist_id");
}

describe("listAssignmentsForMatches", () => {
  it("reads every game's labels in one query, without a playlist scope", async () => {
    const { c, reads } = client([row("m1", 1, "L1"), row("m2", 7, "L2")]);
    const out = await listAssignmentsForMatches(c, "org", ["m1", "m2", "m1"]);
    expect(reads).toHaveLength(1);
    expect(reads[0].eq).toEqual([["org_id", "org"]]);
    expect(reads[0].in).toEqual([["match_id", ["m1", "m2"]]]);
    expectNoScope(reads[0]);
    expect(out.map((a) => `${a.matchId}:${a.eventId}:${a.labelId}`)).toEqual(["m1:1:L1", "m2:7:L2"]);
  });

  it("returns [] without a read for no games, and on a failed read", async () => {
    const empty = client([]);
    expect(await listAssignmentsForMatches(empty.c, "org", [])).toEqual([]);
    expect(empty.reads).toHaveLength(0);
    const failing = client([], { message: "boom" });
    expect(await listAssignmentsForMatches(failing.c, "org", ["m1"])).toEqual([]);
  });
});

describe("setClipAssignments", () => {
  it("adds the missing labels and removes the extra ones, on the clip itself", async () => {
    // The clip has L1 and L2; it should end up with L2 and L3.
    const { c, reads, deletes, inserts } = client([{ label_id: "L1" }, { label_id: "L2" }]);
    await setClipAssignments(c, "org", "m1", 5, ["L2", "L3"]);
    expect(reads).toHaveLength(1);
    expectNoScope(reads[0]);
    expect(inserts).toEqual([[{ user_id: "u1", org_id: "org", match_id: "m1", event_id: 5, label_id: "L3" }]]);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].in).toEqual([["label_id", ["L1"]]]);
    expectNoScope(deletes[0]);
  });
});

describe("bulkAssign", () => {
  it("adds a label to every clip that lacks it, on the clips themselves", async () => {
    const { c, reads, inserts } = client([]);
    await bulkAssign(c, "org", [{ matchId: "m1", eventId: 1 }, { matchId: "m2", eventId: 2 }], "L1", "add");
    expect(reads).toHaveLength(2);
    reads.forEach(expectNoScope);
    expect(inserts).toEqual([[
      { user_id: "u1", org_id: "org", match_id: "m1", event_id: 1, label_id: "L1" },
      { user_id: "u1", org_id: "org", match_id: "m2", event_id: 2, label_id: "L1" },
    ]]);
  });

  it("removes a label from the clips wherever it is", async () => {
    const { c, deletes } = client([]);
    await bulkAssign(c, "org", [{ matchId: "m1", eventId: 1 }, { matchId: "m1", eventId: 3 }], "L1", "remove");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].in).toEqual([["event_id", [1, 3]]]);
    expectNoScope(deletes[0]);
  });
});
