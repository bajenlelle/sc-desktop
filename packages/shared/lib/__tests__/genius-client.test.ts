import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGeniusSeason } from "../genius-client";
import type { SeasonPayload } from "../season-payload";

function mockClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  const client = { functions: { invoke } } as unknown as SupabaseClient;
  return { client, invoke };
}

const payload: SeasonPayload = { games: [{ matchId: 1, matchType: "REGULAR", homeTeamId: 10, awayTeamId: 20 }], standings: [], fetchedAt: "t" };

describe("getGeniusSeason", () => {
  it("asks the genius function for the competition's season", async () => {
    const { client, invoke } = mockClient({ data: payload, error: null });
    expect(await getGeniusSeason(client, 48974)).toEqual({ ok: true, data: payload });
    expect(invoke).toHaveBeenCalledWith("genius", { body: { action: "season", competitionId: 48974 } });
  });

  it("surfaces the function's error token", async () => {
    const { client } = mockClient({ data: null, error: { context: { json: async () => ({ error: "upstream_failed" }) } } });
    expect(await getGeniusSeason(client, 48974)).toEqual({ ok: false, error: "upstream_failed" });
  });
});
