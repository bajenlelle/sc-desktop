/**
 * The league's rosters (league_player_teams, migration 20261119100000): who
 * played for which team in a season. Written only by the `genius` function's
 * roster sync; signed-in users read it. Isomorphic: callers pass their client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RosterMember {
  /** The source's person id (a Genius personId), as the season page keys players. */
  personId: string;
  shirtNumber: string | null;
}

/** A team's roster for the season its id belongs to. Throws on a failed read. */
export async function listTeamRoster(supabase: SupabaseClient, sourceTeamId: string, source = "genius"): Promise<RosterMember[]> {
  const { data, error } = await supabase
    .from("league_player_teams")
    .select("source_person_id, shirt_number")
    .eq("source", source)
    .eq("source_team_id", sourceTeamId);
  if (error) throw new Error(`Failed to load the team's roster: ${error.message}`);
  return ((data ?? []) as { source_person_id: string; shirt_number: string | null }[]).map((r) => ({
    personId: r.source_person_id,
    shirtNumber: r.shirt_number,
  }));
}
