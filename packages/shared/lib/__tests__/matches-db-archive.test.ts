import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setMatchArchived } from "../matches-db";

/** Thenable chain double: records the update, eq and select args, resolves to `result`. */
function mockClient(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["update", "eq", "select"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const from = vi.fn(() => builder);
  const client = { from } as unknown as SupabaseClient;
  const argsOf = (method: string) => calls.find((c) => c.method === method)?.args;
  return { client, from, argsOf };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setMatchArchived", () => {
  it("archiving writes the time and returns what the database stored", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T09:00:00Z"));
    const { client, from, argsOf } = mockClient({ data: [{ archived_at: "2026-11-12T09:00:00+00:00" }], error: null });
    await expect(setMatchArchived(client, "m1", true)).resolves.toBe("2026-11-12T09:00:00+00:00");
    expect(from).toHaveBeenCalledWith("matches");
    expect(argsOf("update")).toEqual([{ archived_at: "2026-11-12T09:00:00.000Z" }]);
    expect(argsOf("eq")).toEqual(["id", "m1"]);
    expect(argsOf("select")).toEqual(["archived_at"]);
  });

  it("bringing a game back writes null and returns null", async () => {
    const { client, argsOf } = mockClient({ data: [{ archived_at: null }], error: null });
    await expect(setMatchArchived(client, "m1", false)).resolves.toBeNull();
    expect(argsOf("update")).toEqual([{ archived_at: null }]);
  });

  it("a game the caller can't change throws instead of looking archived", async () => {
    const { client } = mockClient({ data: [], error: null });
    await expect(setMatchArchived(client, "m1", true)).rejects.toThrow("may belong to another account");
  });

  it("a database error throws", async () => {
    const { client } = mockClient({ data: null, error: { message: "boom" } });
    await expect(setMatchArchived(client, "m1", true)).rejects.toThrow("Failed to archive game: boom");
  });
});
