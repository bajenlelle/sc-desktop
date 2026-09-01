/**
 * Team roster reads. Isomorphic — callers pass their platform Supabase
 * client. RLS (team_members_select_same_team) limits results to teams the
 * caller belongs to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";
import { currentUserId } from "./current-user";

export interface TeamMemberRef {
  teamId: string;
  userId: string;
  role: "coach" | "player";
}

export interface MyTeamRef {
  teamId: string;
  teamName: string;
  orgId: string;
  orgName: string;
}

/**
 * Every team the current user belongs to, across ALL orgs, with org
 * attribution. Powers the player's aggregated feed (badging playlists by
 * club/team without an active-space concept). RLS scopes the join to the
 * caller's own memberships.
 */
export async function getMyTeamsAcrossOrgs(
  supabase: SupabaseClient,
): Promise<MyTeamRef[]> {
  const uid = await currentUserId(supabase);
  if (!uid) return [];
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, teams (id, name, org_id, organizations (name))")
    .eq("user_id", uid);
  if (error) { reportDbError("getMyTeamsAcrossOrgs", error); return []; }
  type Row = {
    team_id: string;
    teams: { id: string; name: string; org_id: string; organizations: { name: string } | null } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.teams !== null)
    .map((r) => ({
      teamId: r.team_id,
      teamName: r.teams!.name,
      orgId: r.teams!.org_id,
      orgName: r.teams!.organizations?.name ?? "",
    }));
}

/**
 * Members of the given teams WITH team attribution — the existing desktop
 * getTeamMemberIds drops team_id, which the coach dashboard needs to know
 * which team a playlist reached someone through.
 */
export async function getTeamMembers(
  supabase: SupabaseClient,
  teamIds: string[],
): Promise<TeamMemberRef[]> {
  if (teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, user_id, role")
    .in("team_id", teamIds);
  if (error) { reportDbError("getTeamMembers", error); return []; }
  return ((data ?? []) as { team_id: string; user_id: string; role: string }[]).map((r) => ({
    teamId: r.team_id,
    userId: r.user_id,
    role: (r.role === "coach" ? "coach" : "player"),
  }));
}
