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

/**
 * What the desktop shell should render for the current auth snapshot.
 * - `loading`        — session or first profile load in flight
 * - `login`          — no session
 * - `device-blocked` — device hard cap refused this device
 * - `unavailable`    — signed in, but we could not read who they are
 * - `app`            — render the app
 */
export type GateState = 'loading' | 'login' | 'device-blocked' | 'unavailable' | 'app';

export interface GateSnapshot {
  hasUser: boolean;
  sessionLoading: boolean;
  profileLoading: boolean;
  hasProfile: boolean;
  /** A read has SUCCEEDED at least once. False means "not known yet". */
  orgsLoaded: boolean;
  orgCount: number;
  deviceBlocked: boolean;
}

/**
 * The desktop shell's routing decision.
 *
 * The invariant this exists to protect: a signed-in user is NEVER blocked for
 * belonging to no club. Every account gets a personal org in the signup
 * transaction (handle_new_user), so `orgCount === 0` is not a real state — it
 * used to mean "the org read failed", and treating the two alike stranded
 * working users on a full-screen invite-code prompt. `orgsLoaded` is what
 * separates "unknown" from "none"; an unknown org list is a retryable error,
 * never a reason to demand an invite code.
 */
export function resolveGateState(s: GateSnapshot): GateState {
  if (s.sessionLoading) return 'loading';
  if (!s.hasUser) return 'login';
  if (s.profileLoading) return 'loading';
  // Device cap outranks the rest: it is a deliberate refusal, not a failure.
  if (s.deviceBlocked) return 'device-blocked';
  // Couldn't read the account — offer a retry rather than guessing at it.
  if (!s.hasProfile || !s.orgsLoaded) return 'unavailable';
  // Note the absence of an orgCount check. Zero orgs is self-healing
  // (ensure_personal_org) and must never gate the app.
  return 'app';
}

/**
 * The invite code inside whatever the user pasted — a bare code or a join
 * link.
 *
 * Invites are only ever handed out as links: the invite modal copies
 * `<app>/join/<code>` and the invite email sends that same URL behind a
 * button. Nothing in the product shows the six characters on their own, so a
 * link is what people actually hold — and a code-only field made the one
 * thing they can paste the one thing guaranteed to fail.
 *
 * Returns null when there is no code-shaped token to find. Validity is still
 * the server's call (join_by_code raises invalid_code); this only decides
 * whether there is anything worth sending.
 */
export function parseInviteInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // From a link, take the segment after /join/ — ignoring any query string,
  // hash or trailing slash that came along with the copy.
  const fromUrl = trimmed.match(/\/join\/([^/?#\s]+)/i);
  const candidate = (fromUrl ? fromUrl[1] : trimmed).toUpperCase();
  // Codes are 6 uppercase hex chars today; accept any alphanumeric 6 so a
  // change to generation doesn't silently reject valid invites here.
  return /^[A-Z0-9]{6}$/.test(candidate) ? candidate : null;
}
