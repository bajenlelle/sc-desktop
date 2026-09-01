import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyTeamsAcrossOrgs } from "../teams-db";

type TeamsJoin = {
  team_id: string;
  teams: { id: string; name: string; org_id: string; organizations: { name: string } | null } | null;
};

/**
 * Minimal Supabase double for the one chain getMyTeamsAcrossOrgs uses:
 * currentUserId() -> auth.getSession(), then
 * from("team_members").select(...).eq("user_id", id).
 */
function mockClient(
  user: { id: string } | null,
  result: { data: TeamsJoin[] | null; error: { message: string } | null },
) {
  const calls: { from: string[]; eq: unknown[][] } = { from: [], eq: [] };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
    },
    from(table: string) {
      calls.from.push(table);
      return {
        select: () => ({
          eq: async (...args: unknown[]) => {
            calls.eq.push(args);
            return result;
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function joinRow(partial: Partial<TeamsJoin>): TeamsJoin {
  return {
    team_id: "t1",
    teams: { id: "t1", name: "U16", org_id: "o1", organizations: { name: "Bajen" } },
    ...partial,
  };
}

describe("getMyTeamsAcrossOrgs", () => {
  it("maps join rows to MyTeamRef with the nested organization name", async () => {
    const { client, calls } = mockClient(
      { id: "u1" },
      {
        data: [
          joinRow({}),
          joinRow({
            team_id: "t2",
            teams: { id: "t2", name: "Herr A", org_id: "o2", organizations: { name: "Alvik" } },
          }),
        ],
        error: null,
      },
    );
    await expect(getMyTeamsAcrossOrgs(client)).resolves.toEqual([
      { teamId: "t1", teamName: "U16", orgId: "o1", orgName: "Bajen" },
      { teamId: "t2", teamName: "Herr A", orgId: "o2", orgName: "Alvik" },
    ]);
    expect(calls.from).toEqual(["team_members"]);
    expect(calls.eq).toEqual([["user_id", "u1"]]);
  });

  it("filters out rows whose teams join is null", async () => {
    const { client } = mockClient(
      { id: "u1" },
      { data: [joinRow({ team_id: "gone", teams: null }), joinRow({})], error: null },
    );
    await expect(getMyTeamsAcrossOrgs(client)).resolves.toEqual([
      { teamId: "t1", teamName: "U16", orgId: "o1", orgName: "Bajen" },
    ]);
  });

  it("falls back to an empty orgName when organizations is null", async () => {
    const { client } = mockClient(
      { id: "u1" },
      {
        data: [joinRow({ teams: { id: "t1", name: "U16", org_id: "o1", organizations: null } })],
        error: null,
      },
    );
    const [ref] = await getMyTeamsAcrossOrgs(client);
    expect(ref.orgName).toBe("");
  });

  it("returns [] without querying when there is no authenticated user", async () => {
    const { client, calls } = mockClient(null, { data: [joinRow({})], error: null });
    await expect(getMyTeamsAcrossOrgs(client)).resolves.toEqual([]);
    expect(calls.from).toEqual([]);
  });

  it("degrades to [] on a query error", async () => {
    const { client } = mockClient({ id: "u1" }, { data: null, error: { message: "boom" } });
    await expect(getMyTeamsAcrossOrgs(client)).resolves.toEqual([]);
  });
});
