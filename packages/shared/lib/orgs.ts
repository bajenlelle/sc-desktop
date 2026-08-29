/**
 * Org-membership derivations shared by all three apps' auth contexts.
 */
import type { OrgMembership } from '../types/org';

/**
 * Club orgs first (stable by name), personal last. get_my_orgs() orders the
 * same way server-side since 20260829100000, but every client still falls
 * back to orgs[0] when no active-space choice is stored, so the sort is
 * enforced here too rather than trusting wire order.
 */
export function sortOrgsClubFirst(orgs: OrgMembership[]): OrgMembership[] {
  return [...orgs].sort((a, b) => {
    if (a.isPersonal !== b.isPersonal) return a.isPersonal ? 1 : -1;
    return a.orgName.localeCompare(b.orgName);
  });
}

/**
 * True when the user's only club-org roles are `player` (and they belong to
 * at least one club org). Player-only users get the two-destination nav
 * (My Playlists / My Highlights) instead of the space switcher — tenancy is
 * a coach/admin concept.
 */
export function isPlayerOnly(orgs: OrgMembership[]): boolean {
  const clubOrgs = orgs.filter((o) => !o.isPersonal);
  return clubOrgs.length > 0 && clubOrgs.every((o) => o.role === 'player');
}
