import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "../edge-function";

function fakeClient(result: { data?: unknown; error?: unknown }, calls: unknown[] = []) {
  return {
    functions: {
      invoke: async (name: string, opts: unknown) => {
        calls.push([name, opts]);
        return result;
      },
    },
  } as unknown as SupabaseClient;
}

describe("invokeEdgeFunction", () => {
  it("passes the function name and body through and returns the data on success", async () => {
    const calls: unknown[] = [];
    const res = await invokeEdgeFunction<{ x: number }>(fakeClient({ data: { x: 1 } }, calls), "profixio", {
      action: "leagues",
    });
    expect(res).toEqual({ ok: true, data: { x: 1 } });
    expect(calls).toEqual([["profixio", { body: { action: "leagues" } }]]);
  });

  it("surfaces the function's snake-case error token", async () => {
    const error = { context: new Response(JSON.stringify({ error: "unknown_league" }), { status: 404 }) };
    const res = await invokeEdgeFunction(fakeClient({ error }), "profixio", {});
    expect(res).toEqual({ ok: false, error: "unknown_league" });
  });

  it("falls back to a generic token when the error carries no body", async () => {
    expect(await invokeEdgeFunction(fakeClient({ error: new Error("boom") }), "profixio", {})).toEqual({
      ok: false,
      error: "request_failed",
    });
    const unparseable = { context: new Response("not json", { status: 502 }) };
    expect(await invokeEdgeFunction(fakeClient({ error: unparseable }), "profixio", {})).toEqual({
      ok: false,
      error: "request_failed",
    });
  });
});
