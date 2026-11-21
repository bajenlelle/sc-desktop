import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTeamRoster } from "../league-players-db";

/** A thenable query builder: every chained call returns itself and records it. */
function mockFrom(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

describe("listTeamRoster", () => {
  it("reads one team's roster by its season id", async () => {
    const { client, from, calls } = mockFrom({
      data: [
        { source_person_id: "11", shirt_number: "7" },
        { source_person_id: "12", shirt_number: null },
      ],
      error: null,
    });
    expect(await listTeamRoster(client, "900")).toEqual([
      { personId: "11", shirtNumber: "7" },
      { personId: "12", shirtNumber: null },
    ]);
    expect(from).toHaveBeenCalledWith("league_player_teams");
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["source", "genius"],
      ["source_team_id", "900"],
    ]);
  });

  it("throws when the read fails", async () => {
    const { client } = mockFrom({ data: null, error: { message: "boom" } });
    await expect(listTeamRoster(client, "900")).rejects.toThrow();
  });
});
