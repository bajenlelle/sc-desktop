import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMyTeamChoices,
  getSpaceTeamSuggestions,
  listLeagueTeams,
  setMyTeam,
} from "../league-teams-db";

const teamRow = {
  id: "t1",
  name: "Sollentuna Basket",
  club_name: "Sollentuna Basketklubb",
  club_key: "genius:25538",
  gender: "men",
  league_id: "superettan-herr",
  league_name: "Superettan Herr",
  season_id: "2026-27",
  logo_url: "https://img/sol.png",
};

const team = {
  id: "t1",
  name: "Sollentuna Basket",
  clubName: "Sollentuna Basketklubb",
  clubKey: "genius:25538",
  gender: "men",
  leagueId: "superettan-herr",
  leagueName: "Superettan Herr",
  seasonId: "2026-27",
  logoUrl: "https://img/sol.png",
};

/** A thenable query builder: every chained call returns itself and records it. */
function mockFrom(result: { data: unknown; error: unknown }, uid: string | null = "u1") {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) {
    builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const from = vi.fn(() => builder);
  const client = {
    from,
    auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }) },
  } as unknown as SupabaseClient;
  return { client, from, calls };
}

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("listLeagueTeams", () => {
  it("maps rows to teams", async () => {
    const { client, from } = mockFrom({ data: [teamRow], error: null });
    expect(await listLeagueTeams(client)).toEqual([team]);
    expect(from).toHaveBeenCalledWith("league_teams");
  });

  it("throws on an error", async () => {
    const { client } = mockFrom({ data: null, error: { message: "boom" } });
    await expect(listLeagueTeams(client)).rejects.toThrow(/boom/);
  });
});

describe("getMyTeamChoices", () => {
  it("reads the caller's own answers with the team embedded", async () => {
    const { client, from, calls } = mockFrom({
      data: [
        { org_id: "club", unlisted_team: null, updated_at: "2026-10-07T10:00:00Z", league_teams: teamRow },
        { org_id: "me", unlisted_team: "Sollentuna U16", updated_at: "2026-10-07T10:00:00Z", league_teams: null },
      ],
      error: null,
    });
    expect(await getMyTeamChoices(client)).toEqual([
      { orgId: "club", team, unlistedTeam: null, updatedAt: "2026-10-07T10:00:00Z" },
      { orgId: "me", team: null, unlistedTeam: "Sollentuna U16", updatedAt: "2026-10-07T10:00:00Z" },
    ]);
    expect(from).toHaveBeenCalledWith("space_team_choices");
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "u1"] });
  });

  it("returns nothing without a session", async () => {
    const { client, from } = mockFrom({ data: [], error: null }, null);
    expect(await getMyTeamChoices(client)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("setMyTeam", () => {
  it("records a team for several spaces", async () => {
    const { client, rpc } = mockRpc({ data: 2, error: null });
    await setMyTeam(client, ["club", "me"], { teamId: "t1" });
    expect(rpc).toHaveBeenCalledWith("set_my_team", { p_org_ids: ["club", "me"], p_league_team_id: "t1", p_unlisted_team: null });
  });

  it("records a note or a skip, and throws the server's reason", async () => {
    const { client, rpc } = mockRpc({ data: 1, error: null });
    await setMyTeam(client, ["me"], { unlistedTeam: "Sollentuna U16" });
    await setMyTeam(client, ["me"], {});
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_league_team_id: null, p_unlisted_team: "Sollentuna U16" });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_league_team_id: null, p_unlisted_team: null });

    const failing = mockRpc({ data: null, error: { message: "not_member" } });
    await expect(setMyTeam(failing.client, ["x"], {})).rejects.toThrow(/not_member/);
  });
});

describe("getSpaceTeamSuggestions", () => {
  it("maps the suggested teams", async () => {
    const { client, rpc } = mockRpc({ data: [teamRow], error: null });
    expect(await getSpaceTeamSuggestions(client, "club")).toEqual([team]);
    expect(rpc).toHaveBeenCalledWith("get_space_team_suggestions", { p_org_id: "club" });
  });
});
