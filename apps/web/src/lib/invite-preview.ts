import type { InviteInvalidReason, InvitePreview, UserRole } from "@scoutable/shared/types/org";
import { roleLabel } from "@/lib/roles";

/** The row `get_invite_preview` returns. */
export interface InvitePreviewRow {
  valid: boolean;
  reason?: string;
  already_member?: boolean;
  org_name?: string;
  team_name?: string | null;
  role?: string;
  email?: string | null;
}

export function toInvitePreview(row: InvitePreviewRow | null | undefined): InvitePreview {
  if (!row) return { valid: false, reason: "not_found" };
  return {
    valid: row.valid,
    reason: row.reason as InviteInvalidReason | undefined,
    alreadyMember: row.already_member === true,
    orgName: row.org_name,
    teamName: row.team_name ?? null,
    role: row.role as UserRole | undefined,
    email: row.email ?? null,
  };
}

/** "Hammarby Basket — U16 Herr", or the club alone. */
export function inviteDestination(preview: InvitePreview, fallback: string): string {
  return preview.teamName ? `${preview.orgName} — ${preview.teamName}` : preview.orgName ?? fallback;
}

/** "a coach", "an admin": the role as the sentence says it. */
export function asRole(role: string): string {
  const label = roleLabel(role).toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
}
