/**
 * Reads and writes for "Your team" (league_teams / space_team_choices,
 * migration 20261009100000). Isomorphic — callers pass their platform
 * Supabase client. The team catalogue is public league data; a user's answers
 * are readable only by them (RLS) and written through set_my_team.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeagueTeam, TeamChoice } from '../types/league-team';
import type { TeamSource } from './team-games';
import { currentUserId } from './current-user';

const TEAM_COLUMNS = 'id, name, club_name, club_key, gender, league_id, league_name, season_id, logo_url';

interface TeamRow {
  id: string;
  name: string;
  club_name: string | null;
  club_key: string | null;
  gender: 'men' | 'women' | null;
  league_id: string;
  league_name: string;
  season_id: string;
  logo_url: string | null;
}

function rowToLeagueTeam(r: TeamRow): LeagueTeam {
  return {
    id: r.id,
    name: r.name,
    clubName: r.club_name,
    clubKey: r.club_key,
    gender: r.gender,
    leagueId: r.league_id,
    leagueName: r.league_name,
    seasonId: r.season_id,
    logoUrl: r.logo_url,
  };
}

/** The whole catalogue (about a hundred teams); filter with currentTeams for the picker. */
export async function listLeagueTeams(supabase: SupabaseClient): Promise<LeagueTeam[]> {
  const { data, error } = await supabase.from('league_teams').select(TEAM_COLUMNS);
  if (error) throw new Error(`Failed to load teams: ${error.message}`);
  return ((data ?? []) as TeamRow[]).map(rowToLeagueTeam);
}

/** The caller's answer for each space they were asked in. */
export async function getMyTeamChoices(supabase: SupabaseClient): Promise<TeamChoice[]> {
  const uid = await currentUserId(supabase);
  if (!uid) return [];
  const { data, error } = await supabase
    .from('space_team_choices')
    .select(`org_id, unlisted_team, updated_at, league_teams (${TEAM_COLUMNS})`)
    .eq('user_id', uid);
  if (error) throw new Error(`Failed to load your team: ${error.message}`);
  type Row = { org_id: string; unlisted_team: string | null; updated_at: string; league_teams: TeamRow | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    orgId: r.org_id,
    team: r.league_teams ? rowToLeagueTeam(r.league_teams) : null,
    unlistedTeam: r.unlisted_team,
    updatedAt: r.updated_at,
  }));
}

/**
 * Records the caller's answer for one or more spaces: a team, an
 * "isn't listed" note, or neither (skip). Throws the server's reason
 * (not_member, unknown_team, unlisted_team_too_long).
 */
export async function setMyTeam(
  supabase: SupabaseClient,
  orgIds: string[],
  answer: { teamId?: string | null; unlistedTeam?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('set_my_team', {
    p_org_ids: orgIds,
    p_league_team_id: answer.teamId ?? null,
    p_unlisted_team: answer.unlistedTeam ?? null,
  });
  if (error) throw new Error(`Failed to save your team: ${error.message}`);
}

/** Teams of the clubs other members of a club space picked; empty for personal spaces. */
export async function getSpaceTeamSuggestions(supabase: SupabaseClient, orgId: string): Promise<LeagueTeam[]> {
  const { data, error } = await supabase.rpc('get_space_team_suggestions', { p_org_id: orgId });
  if (error) throw new Error(`Failed to load your club's teams: ${error.message}`);
  return ((data ?? []) as TeamRow[]).map(rowToLeagueTeam);
}

/** Every season's source id for a team (league_team_sources), for matching schedules. */
export async function getTeamSources(supabase: SupabaseClient, leagueTeamId: string): Promise<TeamSource[]> {
  const { data, error } = await supabase
    .from('league_team_sources')
    .select('source, source_team_id, league_id, season_id')
    .eq('league_team_id', leagueTeamId);
  if (error) throw new Error(`Failed to load your team's seasons: ${error.message}`);
  type Row = { source: string; source_team_id: string; league_id: string; season_id: string };
  return ((data ?? []) as Row[]).map((r) => ({
    source: r.source,
    sourceTeamId: r.source_team_id,
    leagueId: r.league_id,
    seasonId: r.season_id,
  }));
}
