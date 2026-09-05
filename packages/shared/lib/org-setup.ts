/**
 * Admin org-setup progress — the data behind the "set up your club"
 * checklist shown to club admins on web and desktop.
 *
 * Derived from real org data (teams, members, invites) rather than stored
 * per-step, matching the Getting Started convention: it stays honest across
 * devices and never needs resetting. Admins don't count toward "invite your
 * coaches" — the admin is usually the person looking at the checklist, and
 * the step is about bringing in the coaching staff.
 *
 * The invite steps complete on the admin's ACTION, not on someone joining:
 * an email invite (org_invites row with email set) or a copied invite link
 * (copied_at stamped by mark_org_invite_copied) checks the step. Mere
 * existence of a link row does NOT count — the invite modal creates one
 * eagerly on open, so it would self-complete the step.
 */

export interface OrgSetupInvite {
  role: string;
  /** Set only for email invites — created exclusively by an explicit send. */
  email: string | null;
  /** Stamped when staff copied the invite link to the clipboard. */
  copiedAt: string | null;
}

export interface OrgSetupProgress {
  teamsDone: boolean;
  coachesDone: boolean;
  playersDone: boolean;
  doneCount: number;
  total: number;
  allDone: boolean;
}

export function deriveOrgSetupProgress(
  teams: ReadonlyArray<{ id: string }>,
  members: ReadonlyArray<{ role: string }>,
  invites: ReadonlyArray<OrgSetupInvite> = [],
): OrgSetupProgress {
  const invited = (role: string) =>
    invites.some((i) => i.role === role && (i.email != null || i.copiedAt != null));
  const teamsDone = teams.length > 0;
  const coachesDone = members.some((m) => m.role === "coach") || invited("coach");
  const playersDone = members.some((m) => m.role === "player") || invited("player");
  const doneCount = [teamsDone, coachesDone, playersDone].filter(Boolean).length;
  return { teamsDone, coachesDone, playersDone, doneCount, total: 3, allDone: doneCount === 3 };
}
