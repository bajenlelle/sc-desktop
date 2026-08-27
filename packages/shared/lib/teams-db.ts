/**
 * Team roster reads. Isomorphic — callers pass their platform Supabase
 * client. RLS (team_members_select_same_team) limits results to teams the
 * caller belongs to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";

export interface TeamMemberRef {
  teamId: string;
  userId: string;
  role: "coach" | "player";
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
