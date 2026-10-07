// =============================================================================
// League teams: the real-world teams users coach or play for
// (league_teams / space_team_choices, migration 20261009100000)
// =============================================================================

export type TeamGender = 'men' | 'women';

/** Scoutable's stable record of a real team; each season's source id links to it. */
export interface LeagueTeam {
  id: string;
  /** The newest season's name, e.g. "Sollentuna Basket". */
  name: string;
  /** The club behind the team, e.g. "Sollentuna Basketklubb". */
  clubName: string | null;
  /** '<source>:<club id>', groups a club's teams; null when the source has no clubs. */
  clubKey: string | null;
  gender: TeamGender | null;
  /** Newest league seen, e.g. superettan-herr / "Superettan Herr". */
  leagueId: string;
  leagueName: string;
  /** Newest season seen, e.g. "2026-27". */
  seasonId: string;
  logoUrl: string | null;
}

/** A user's answer for one space. A row means they were asked. */
export interface TeamChoice {
  orgId: string;
  /** null when they skipped or said their team isn't listed. */
  team: LeagueTeam | null;
  /** What they typed under "My team isn't listed". */
  unlistedTeam: string | null;
  updatedAt: string;
}

/** Whether the user coaches or plays for the team in a space; drives copy only. */
export type TeamRole = 'coach' | 'player';
