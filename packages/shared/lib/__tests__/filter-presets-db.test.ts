import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClipFilters } from "../clip-filters";
import { createFilterPreset, listFilterPresets, renameFilterPreset } from "../filter-presets-db";

type Result = { data: unknown; error: unknown };

/** A client whose query on `filter_presets` answers with `result`, recording the `eq` and `insert` arguments. */
function client(result: Result) {
  const eqs: unknown[][] = [];
  const inserts: unknown[] = [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (...args: unknown[]) => { eqs.push(args); return chain; },
    order: () => chain,
    insert: (payload: unknown) => { inserts.push(payload); return chain; },
    update: () => chain,
    single: () => Promise.resolve(result),
    then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  const c = {
    from: () => chain,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u" } }, error: null }) },
  } as unknown as SupabaseClient;
  return { client: c, eqs, inserts };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Guard offence",
  // A row from before presets dropped teams and players (2026-11-13) may still carry them.
  filters: { v: 1, types: ["2pt-made"], shotTypes: [], situations: [], teams: ["AIK"], players: ["id:8"], labels: ["l1"] },
  created_at: "2026-11-12T00:00:00Z",
  ...over,
});

const guard: ClipFilters = {
  types: new Set(["3pt-miss", "2pt-made", "3pt-made", "2pt-miss"]),
  shotTypes: new Set(), situations: new Set(), teams: new Set(["AIK"]), players: new Set(["id:8"]), labels: new Set(),
};

describe("listFilterPresets", () => {
  it("lists the space's presets with their filters", async () => {
    const { client: c, eqs } = client({ data: [row()], error: null });
    const presets = await listFilterPresets(c, "o");
    expect(eqs).toContainEqual(["org_id", "o"]);
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe("p1");
    expect(presets[0].name).toBe("Guard offence");
    expect(presets[0].createdAt).toBe("2026-11-12T00:00:00Z");
    expect([...presets[0].filters.types]).toEqual(["2pt-made"]);
    expect([...(presets[0].filters.labels ?? [])]).toEqual(["l1"]);
    expect(presets[0].filters.teams.size, "an old row's teams are ignored").toBe(0);
    expect(presets[0].filters.players.size, "an old row's players are ignored").toBe(0);
  });

  it("skips a row whose filters it can't read", async () => {
    const { client: c } = client({ data: [row({ id: "bad", filters: [] }), row()], error: null });
    expect((await listFilterPresets(c, "o")).map((p) => p.id)).toEqual(["p1"]);
  });

  it("lists none from a database the migration hasn't reached", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      const { client: c } = client({ data: null, error: { code, message: "no table" } });
      expect(await listFilterPresets(c, "o")).toEqual([]);
    }
  });
});

describe("createFilterPreset", () => {
  it("saves under the user with the serialised preset groups (never the team or players) and a trimmed name", async () => {
    const { client: c, inserts } = client({ data: row(), error: null });
    await createFilterPreset(c, "o", "  Guard offence ", guard);
    expect(inserts).toEqual([{
      user_id: "u",
      org_id: "o",
      name: "Guard offence",
      filters: { v: 1, types: ["2pt-made", "2pt-miss", "3pt-made", "3pt-miss"], shotTypes: [], situations: [], labels: [] },
    }]);
  });
});

describe("a taken name", () => {
  it("says a taken name as duplicate_name", async () => {
    const taken = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    await expect(createFilterPreset(client(taken).client, "o", "Guard offence", guard)).rejects.toThrow(/duplicate_name/);
    await expect(renameFilterPreset(client(taken).client, "p1", "Guard offence")).rejects.toThrow(/duplicate_name/);
  });
});
