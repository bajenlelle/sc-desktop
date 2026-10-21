import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAssignmentsForClips } from "../labels-db";

function row(matchId: string, eventId: number, labelId: string, playlistId: string | null = null) {
  return { user_id: "u1", org_id: "org", match_id: matchId, event_id: eventId, label_id: labelId, playlist_id: playlistId, assigned_at: "2026-10-21T00:00:00Z" };
}

/** Records the one chain a read builds and answers it with `rows` (or `error`). */
function client(rows: ReturnType<typeof row>[], error: { message: string } | null = null) {
  const reads: Array<{ eq: [string, unknown][]; in: [string, unknown[]][]; is: [string, unknown][] }> = [];
  const c = {
    from() {
      const read = { eq: [] as [string, unknown][], in: [] as [string, unknown[]][], is: [] as [string, unknown][] };
      reads.push(read);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, v: unknown) => (read.eq.push([col, v]), b),
        in: (col: string, v: unknown[]) => (read.in.push([col, v]), b),
        is: (col: string, v: unknown) => (read.is.push([col, v]), b),
        then: (r: (x: unknown) => unknown) => Promise.resolve({ data: error ? null : rows, error }).then(r),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { c, reads };
}

describe("listAssignmentsForClips", () => {
  it("reads every game's assignments in one query", async () => {
    const { c, reads } = client([row("m1", 1, "L1"), row("m2", 7, "L2")]);
    const out = await listAssignmentsForClips(c, "org", [
      { matchId: "m1", eventId: 1 },
      { matchId: "m2", eventId: 7 },
      { matchId: "m1", eventId: 3 },
    ], null);
    expect(reads).toHaveLength(1);
    expect(reads[0].in).toEqual([
      ["match_id", ["m1", "m2"]],
      ["event_id", [1, 7, 3]],
    ]);
    expect(reads[0].is).toEqual([["playlist_id", null]]);
    expect(out.map((a) => `${a.matchId}:${a.eventId}:${a.labelId}`)).toEqual(["m1:1:L1", "m2:7:L2"]);
  });

  it("drops rows the crossed IN lists let through", async () => {
    // m2:1 was never asked for; event 1 was asked for in m1 only.
    const { c } = client([row("m1", 1, "L1"), row("m2", 1, "L9")]);
    const out = await listAssignmentsForClips(c, "org", [
      { matchId: "m1", eventId: 1 },
      { matchId: "m2", eventId: 7 },
    ], "pl-1");
    expect(out.map((a) => `${a.matchId}:${a.eventId}`)).toEqual(["m1:1"]);
  });

  it("scopes to a playlist", async () => {
    const { c, reads } = client([]);
    await listAssignmentsForClips(c, "org", [{ matchId: "m1", eventId: 1 }], "pl-1");
    expect(reads[0].eq).toEqual([
      ["org_id", "org"],
      ["playlist_id", "pl-1"],
    ]);
  });

  it("returns [] without a read for no clips, and on a failed read", async () => {
    const empty = client([]);
    expect(await listAssignmentsForClips(empty.c, "org", [], null)).toEqual([]);
    expect(empty.reads).toHaveLength(0);
    const failing = client([], { message: "boom" });
    expect(await listAssignmentsForClips(failing.c, "org", [{ matchId: "m1", eventId: 1 }], null)).toEqual([]);
  });
});
