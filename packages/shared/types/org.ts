// =============================================================================
// Org, Team & Profile types
// =============================================================================

export type UserRole = 'coach' | 'player' | 'admin';
export type OrgPlanTier = 'free' | 'rookie' | 'pro' | 'franchise';
export type InviteInvalidReason = 'not_found' | 'expired_invite' | 'exhausted' | 'expired_license';

export interface UserProfile {
  id: string;
  fullName: string | null;
  email?: string | null;
  avatarUrl: string | null;
  role: UserRole;
  orgId: string | null;
  createdAt: string;
  isPlatformAdmin: boolean;
  /** Highest paid tier already thanked-for; gates the one-time upgrade celebration. */
  celebratedPlanTier?: 'rookie' | 'pro' | null;
  /** When the desktop Getting Started checklist was dismissed; null = show it. */
  onboardingChecklistDismissedAt?: string | null;
  /** When the web welcome surfaces were dismissed; null = show them. */
  welcomeDismissedAt?: string | null;
  /**
   * Self-declared at signup (or inferred from an invite): tailors copy and
   * analytics only — never permissions. null = not captured yet.
   */
  declaredRole?: 'coach' | 'player' | null;
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
  planTier: OrgPlanTier;
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
  planTier: OrgPlanTier;
  planTierLockedAt: string | null;
  isPersonal: boolean;
  ownerEmail: string | null;
}

/** A single org the current user belongs to (replaces SecondaryOrg). */
export interface OrgMembership {
  orgId: string;
  orgName: string;
  role: 'coach' | 'admin' | 'player';
  isNtOrg: boolean;
  planTier: OrgPlanTier;
  isPersonal: boolean;
}

/** @deprecated Use OrgMembership */
export type SecondaryOrg = OrgMembership;

/** Loaded once on profile mount; bundles everything the profile page needs. */
export interface OrgContext {
  profile: UserProfile;
  org: Organization | null;
  myTeams: OrgTeam[];        // teams the current user belongs to
  allOrgTeams: OrgTeam[];    // all teams in the org (admin view)
  orgMembers: UserProfile[]; // all members of this org (admin load)
  myOrgs: OrgMembership[];   // all orgs the user belongs to
  /** @deprecated Use myOrgs */
  secondaryOrgs: OrgMembership[];
}
