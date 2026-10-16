import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findImportedSourceGames } from "../matches-db";

/** Thenable chain double: records every call, resolves to `result`. */
function mockClient(result: { data: unknown; error: unknown }, uid: string | null = "me") {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const from = vi.fn(() => builder);
  const client = {
    from,
    auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }) },
  } as unknown as SupabaseClient;
  return { client, from, calls };
}

describe("findImportedSourceGames", () => {
  it("returns which of the games the caller already imported into the space", async () => {
    const { client, calls } = mockClient({ data: [{ source_game_id: "g1" }, { source_game_id: "g3" }], error: null });
    const got = await findImportedSourceGames(client, ["g1", "g2", "g3"], "org1");
    expect([...got].sort()).toEqual(["g1", "g3"]);
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "me"] });
    expect(calls).toContainEqual({ method: "eq", args: ["org_id", "org1"] });
    expect(calls).toContainEqual({ method: "in", args: ["source_game_id", ["g1", "g2", "g3"]] });
  });

  it("asks nothing for an empty list or without a session", async () => {
    const empty = mockClient({ data: [], error: null });
    expect((await findImportedSourceGames(empty.client, [], "org1")).size).toBe(0);
    expect(empty.from).not.toHaveBeenCalled();

    const signedOut = mockClient({ data: [], error: null }, null);
    expect((await findImportedSourceGames(signedOut.client, ["g1"], "org1")).size).toBe(0);
    expect(signedOut.from).not.toHaveBeenCalled();
  });

  it("treats a read error as nothing imported", async () => {
    const { client } = mockClient({ data: null, error: { message: "boom" } });
    expect((await findImportedSourceGames(client, ["g1"], "org1")).size).toBe(0);
  });
});
