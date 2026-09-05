import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listMatchesLight } from "../matches-db";

interface MatchRow {
  id: string;
  user_id: string;
  title: string;
  game_date: string | null;
  home_team: { name: string; color: string };
  away_team: { name: string; color: string };
  home_roster: Array<{ jerseyNumber: string; playerName: string }>;
  away_roster: Array<{ jerseyNumber: string; playerName: string }>;
  video_url: string | null;
  sync_point: null;
  league_id: string | null;
  season_id: string | null;
  stage_id: string | null;
  org_id: string | null;
  is_demo?: boolean;
  source_game_id?: string | null;
  created_at: string;
  updated_at: string;
}

function matchRow(partial: Partial<MatchRow>): MatchRow {
  return {
    id: "m1",
    user_id: "owner",
    title: "Home vs Away",
    game_date: null,
    home_team: { name: "Home", color: "#111" },
    away_team: { name: "Away", color: "#222" },
    home_roster: [],
    away_roster: [],
    video_url: null,
    sync_point: null,
    league_id: null,
    season_id: null,
    stage_id: null,
    org_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

/**
 * Double for the light-list chain:
 *   from("matches").select("*").order("created_at", …)[.eq("org_id", …)|.or(…)][.eq("user_id", …)]
 * `uid: null` simulates a signed-out session for the ownOnly path.
 */
function mockMatchClient(
  opts: { rows?: MatchRow[]; error?: { message: string }; uid?: string | null } = {},
) {
  const calls: {
    tables: string[];
    eq: Array<[string, unknown]>;
    or: string[];
    order: Array<[string, unknown]>;
  } = { tables: [], eq: [], or: [], order: [] };
  const listResult = { data: opts.error ? null : opts.rows ?? [], error: opts.error ?? null };
  const uid = opts.uid === undefined ? "owner" : opts.uid;
  const b: Record<string, unknown> = {
    select() { return b; },
    eq(col: string, val: unknown) { calls.eq.push([col, val]); return b; },
    or(filter: string) { calls.or.push(filter); return b; },
    order(col: string, o: unknown) { calls.order.push([col, o]); return b; },
    then: (r: (x: typeof listResult) => unknown) => Promise.resolve(listResult).then(r),
  };
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: uid ? { user: { id: uid } } : null },
        error: null,
      }),
      getUser: async () => ({ data: { user: uid ? { id: uid } : null }, error: null }),
    },
    from(table: string) { calls.tables.push(table); return b; },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("listMatchesLight org scoping", () => {
  it("filters by org_id when an orgId is given", async () => {
    const { client, calls } = mockMatchClient({ rows: [matchRow({ org_id: "org-1" })] });
    await listMatchesLight(client, "org-1");
    expect(calls.tables).toEqual(["matches"]);
    expect(calls.eq).toEqual([["org_id", "org-1"]]);
    expect(calls.or).toEqual([]);
  });

  it("includes org_id NULL rows via .or when includeUnscoped is set (personal space)", async () => {
    const { client, calls } = mockMatchClient();
    await listMatchesLight(client, "org-1", { includeUnscoped: true });
    expect(calls.or).toEqual(["org_id.eq.org-1,org_id.is.null"]);
    expect(calls.eq).toEqual([]);
  });

  it("applies no org filter when orgId is omitted, even with includeUnscoped", async () => {
    const { client, calls } = mockMatchClient();
    await listMatchesLight(client, undefined, { includeUnscoped: true });
    expect(calls.eq).toEqual([]);
    expect(calls.or).toEqual([]);
  });

  it("ownOnly narrows to the caller's user_id on top of includeUnscoped", async () => {
    const { client, calls } = mockMatchClient();
    await listMatchesLight(client, "org-1", { includeUnscoped: true, ownOnly: true });
    expect(calls.or).toEqual(["org_id.eq.org-1,org_id.is.null"]);
    expect(calls.eq).toEqual([["user_id", "owner"]]);
  });

  it("ownOnly returns [] when there is no session, even if rows would match", async () => {
    const { client } = mockMatchClient({ rows: [matchRow({})], uid: null });
    await expect(listMatchesLight(client, "org-1", { ownOnly: true })).resolves.toEqual([]);
  });

  it("still orders by created_at descending", async () => {
    const { client, calls } = mockMatchClient();
    await listMatchesLight(client, "org-1");
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
  });

  it("returns matches with an empty events array (light — events never loaded)", async () => {
    const { client } = mockMatchClient({ rows: [matchRow({ org_id: "org-1" })] });
    const [m] = await listMatchesLight(client, "org-1");
    expect(m.events).toEqual([]);
    expect(m.orgId).toBe("org-1");
    expect(m.title).toBe("Home vs Away");
  });

  it("degrades to [] when the query fails", async () => {
    const { client } = mockMatchClient({ error: { message: "boom" } });
    await expect(listMatchesLight(client, "org-1")).resolves.toEqual([]);
  });
});
