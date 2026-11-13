import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countOwnImports } from "../matches-db";

/** Thenable chain double for a head count: records every call, resolves to `result`. */
function mockClient(result: { count: number | null; error: unknown }, uid: string | null = "me") {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, ...result });
  const from = vi.fn(() => builder);
  const client = {
    from,
    auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }) },
  } as unknown as SupabaseClient;
  return { client, from, calls };
}

describe("countOwnImports", () => {
  it("counts the games the caller has ever imported, from the import log", async () => {
    const { client, from, calls } = mockClient({ count: 2, error: null });
    expect(await countOwnImports(client)).toBe(2);
    expect(from).toHaveBeenCalledWith("import_log");
    expect(calls).toContainEqual({ method: "select", args: ["*", { count: "exact", head: true }] });
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "me"] });
  });

  it("says zero, not unknown, for a coach who has never imported", async () => {
    const { client } = mockClient({ count: 0, error: null });
    expect(await countOwnImports(client)).toBe(0);
  });

  it("does not know without a session, and asks nothing", async () => {
    const { client, from } = mockClient({ count: 0, error: null }, null);
    expect(await countOwnImports(client)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("does not know when the read fails", async () => {
    const { client } = mockClient({ count: null, error: { message: "boom" } });
    expect(await countOwnImports(client)).toBeNull();
  });
});
