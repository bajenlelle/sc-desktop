import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { countClubMatchesThisMonth } from "@/lib/matches-db";
import { NT_LEAGUE_IDS, getOrgImportLimit } from "@scoutable/shared/lib/plan-tier";

/**
 * Monthly imports still available in the active personal space.
 *
 * Returns `null` when the quota is irrelevant or unknown — an unlimited tier,
 * a team space (plan is admin-managed there), or the count hasn't loaded yet.
 * Callers render a plain tier chip in that case, so the chip paints
 * immediately and gains the quota once the count arrives.
 */
export function useImportQuota(): number | null {
  const { activeOrgId, activeOrgPlan, activeOrgIsPersonal } = useAuth();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const limit = getOrgImportLimit(activeOrgPlan);
    if (!activeOrgIsPersonal || limit === null || !activeOrgId) {
      setRemaining(null);
      return;
    }
    let cancelled = false;
    const refetch = () => {
      countClubMatchesThisMonth(NT_LEAGUE_IDS, activeOrgId)
        .then((count) => {
          if (!cancelled) setRemaining(Math.max(0, limit - count));
        })
        .catch(() => {
          if (!cancelled) setRemaining(null);
        });
    };
    refetch();
    // The badge outlives every page (it sits in the persistent header), so it
    // re-counts whenever an import or delete changes the month's total.
    window.addEventListener("matches-changed", refetch);
    return () => {
      cancelled = true;
      window.removeEventListener("matches-changed", refetch);
    };
  }, [activeOrgId, activeOrgPlan, activeOrgIsPersonal]);

  return remaining;
}
