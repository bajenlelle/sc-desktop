/**
 * The organization page's "Pending invites" list (web and desktop): emailed
 * invites nobody has accepted yet, expired ones included (they can be resent).
 */
import type { OrgInvite } from "../types/org";

/** Emailed, single-use and unused, newest first. Links (no email) are managed in the invite dialog. */
export function pendingEmailInvites(invites: OrgInvite[]): OrgInvite[] {
  return invites
    .filter((i) => !!i.email && i.maxUses === 1 && i.usedCount < 1)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** "Expires in 5 days", "Expires today", "Expired". */
export function inviteExpiryLabel(expiresAt: string | null, now: number = Date.now()): string {
  if (!expiresAt) return "No expiry";
  const msLeft = new Date(expiresAt).getTime() - now;
  if (msLeft <= 0) return "Expired";
  const days = Math.floor(msLeft / 86400000);
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** Admins manage every invite; coaches manage coach and player invites (resend/revoke_org_invite). */
export function canManageInvite(invite: Pick<OrgInvite, "role">, isAdmin: boolean): boolean {
  return isAdmin || invite.role !== "admin";
}
