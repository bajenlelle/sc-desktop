/**
 * Org license lifecycle state, shared by all apps for banners and gating UI.
 *
 * Display mirror of the `org_license_state` SQL function
 * (supabase/migrations/20260902100000_license_lifecycle.sql) — the server is
 * the enforcement point; this only drives what the UI shows. Keep the 30-day
 * expiring window and the grace default in sync with the SQL and the
 * `license_grace_days` app_config row.
 */

export type LicenseState = "active" | "expiring" | "grace" | "locked";

/** Mirrors app_config license_grace_days (server value wins for enforcement). */
export const LICENSE_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getLicenseState(
  expiresAt: string | null | undefined,
  graceDays: number = LICENSE_GRACE_DAYS,
  now: Date = new Date()
): LicenseState {
  if (!expiresAt) return "active";
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return "active";
  const t = now.getTime();
  if (expiry > t + 30 * DAY_MS) return "active";
  if (expiry > t) return "expiring";
  if (expiry + graceDays * DAY_MS > t) return "grace";
  return "locked";
}

/** Whole days until expiry (>= 1 while in the future); null when no expiry. */
export function daysUntilExpiry(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return null;
  return Math.ceil((expiry - now.getTime()) / DAY_MS);
}

/** Date the grace period ends (sharing pauses); null when no expiry. */
export function graceEndsAt(
  expiresAt: string | null | undefined,
  graceDays: number = LICENSE_GRACE_DAYS
): Date | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return null;
  return new Date(expiry + graceDays * DAY_MS);
}

/**
 * Remaining-seat phrasing per the house quota convention
 * ("2 of 10 coach seats left"). Returns null when the limit is unset.
 */
export function seatsLeftLabel(
  used: number,
  limit: number | null | undefined,
  roleLabel: "coach" | "player"
): string | null {
  if (limit == null) return null;
  const left = Math.max(0, limit - used);
  return `${left} of ${limit} ${roleLabel} seats left`;
}

/** Low-seat warning threshold: 2 seats or fewer left (and a limit is set). */
export function seatsRunningLow(used: number, limit: number | null | undefined): boolean {
  if (limit == null) return false;
  return limit - used <= 2;
}
