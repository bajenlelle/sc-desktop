/**
 * Free-import refills (20261001120000): the /admin candidate list and its
 * CSV export. The rules live in SQL (free_refill_candidates); this only
 * shapes rows for display and export.
 */

export interface FreeRefillCandidate {
  user_id: string;
  email: string;
  full_name: string | null;
  declared_role: string | null;
  used: number;
  allowance: number;
  last_import_at: string | null;
  last_sign_in_at: string | null;
  in_club: boolean;
  had_subscription: boolean;
  email_consent: boolean;
  last_refill_at: string | null;
  eligible_at: string | null;
  eligible_now: boolean;
}

const CSV_COLUMNS: (keyof FreeRefillCandidate)[] = [
  "email",
  "full_name",
  "declared_role",
  "used",
  "allowance",
  "last_import_at",
  "last_sign_in_at",
  "in_club",
  "had_subscription",
  "email_consent",
  "last_refill_at",
  "eligible_at",
  "eligible_now",
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote anything that would break the row, and neutralize spreadsheet
  // formulas (a name starting with "=" must stay text).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function refillCandidatesCsv(rows: FreeRefillCandidate[]): string {
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
}

/** The RPC's error tokens, as admin-facing sentences. */
export function refillErrorMessage(message: string): string {
  if (message.includes("not_eligible")) return "Not eligible: they're not on Free, or they still have imports left.";
  if (message.includes("refilled_recently")) return "Refilled recently. The cooldown hasn't passed yet.";
  if (message.includes("too_soon")) return "Too soon after their last free import.";
  if (message.includes("not_admin")) return "Only platform admins can refill.";
  return `Refill failed: ${message}`;
}
