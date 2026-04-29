// =============================================================================
// Org, Team & Profile types
// =============================================================================

export type UserRole = 'coach' | 'player' | 'admin';

export interface UserProfile {
  id: string;
  fullName: string | null;
  email?: string | null;
  avatarUrl: string | null;
  role: UserRole;
  orgId: string | null;
  createdAt: string;
  isPlatformAdmin: boolean;
}

export interface Organization {
  id: string;
  name: string;
  logoUrl: string | null;
  createdAt: string;
  coachSeatLimit: number | null;
  playerSeatLimit: number | null;
  expiresAt: string | null;
  isNtOrg: boolean;
}

export interface OrgTeam {
  id: string;
  orgId: string;
  name: string;
  sport: string;
  season: string | null;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: 'coach' | 'player';
  joinedAt: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  code: string;
  role: 'coach' | 'player';
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  usedCount: number;
  maxUses: number | null;
}

export interface OrgInvite {
  id: string;
  orgId: string;
  code: string;
  role: 'coach' | 'player' | 'admin';
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  usedCount: number;
  maxUses: number | null;
  isNationalTeam: boolean;
  teamId: string | null;
  email: string | null;
}

export interface OrgWithCount {
  id: string;
  name: string;
  logoUrl: string | null;
  createdAt: string;
  memberCount: number;
  teamCount: number;
}

export interface SecondaryOrg {
  orgId: string;
  orgName: string;
  role: 'coach' | 'admin';
  isNtOrg: boolean;
}

/** Loaded once on profile mount; bundles everything the profile page needs. */
export interface OrgContext {
  profile: UserProfile;
  org: Organization | null;
  myTeams: OrgTeam[];        // teams the current user belongs to
  allOrgTeams: OrgTeam[];    // all teams in the org (admin view)
  orgMembers: UserProfile[]; // all members of this org (admin load)
  secondaryOrgs: SecondaryOrg[]; // orgs the user belongs to other than their primary org
}
