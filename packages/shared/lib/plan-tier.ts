/**
 * Shared display helpers for org plan tiers. Used by both apps for the
 * PlanBadge component and anywhere else a plan needs to be rendered.
 */
import type { OrgPlanTier } from "../types/org";

/**
 * League ids exempt from the monthly club-import cap. Passed to the
 * `count_club_matches_this_month` RPC, which matches them against
 * `matches.league_id` — so these must be *league* ids, not org ids.
 */
export const NT_LEAGUE_IDS: string[] = [
  "sweden-national-men",
  "sweden-national-women",
];

/**
 * Club-match import cap for a tier. `null` = unlimited.
 *
 * Display fallback only — the live numbers (including campaign grants) come
 * from the `get_import_quota` RPC, whose `_import_allowance` SQL twin is the
 * single source of truth. Keep the two in sync when tiers change.
 */
export function getOrgImportLimit(tier: OrgPlanTier): number | null {
  if (tier === "free") return 3;
  if (tier === "rookie") return 10;
  return null;
}

export type ImportWindow = "month" | "lifetime" | "unlimited";

/**
 * How a tier's import cap counts: Free is a lifetime trial pool (deleting a
 * game never refunds it), Rookie resets each calendar month.
 */
export function getImportWindow(tier: OrgPlanTier): ImportWindow {
  if (tier === "free") return "lifetime";
  if (tier === "rookie") return "month";
  return "unlimited";
}

/** Shape returned by the `get_import_quota` RPC. */
export interface ImportQuota {
  tier: OrgPlanTier;
  window: ImportWindow;
  baseLimit: number | null;
  bonus: number;
  limit: number | null;
  used: number;
  remaining: number | null;
}

export function orgPlanLabel(tier: OrgPlanTier): string {
  const map: Record<OrgPlanTier, string> = {
    free: "Free",
    rookie: "Rookie",
    pro: "Pro",
    franchise: "Franchise",
  };
  return map[tier];
}

/**
 * Colour tokens per tier:
 *   - `dot`   applies to a small circular indicator (h-1.5 to h-2)
 *   - `badge` applies to a pill wrapping the label + dot
 */
export function orgPlanColors(tier: OrgPlanTier): { dot: string; badge: string } {
  const map: Record<OrgPlanTier, { dot: string; badge: string }> = {
    free:      { dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground" },
    rookie:    { dot: "bg-violet-500",       badge: "bg-violet-500/10 text-violet-500" },
    pro:       { dot: "bg-blue-500",         badge: "bg-blue-500/10 text-blue-500" },
    franchise: { dot: "bg-amber-500",        badge: "bg-amber-500/10 text-amber-500" },
  };
  return map[tier];
}
