import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { createClient } from "@/lib/supabase/client";
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
    const supabase = createClient();
    supabase
      .rpc("count_club_matches_this_month", {
        p_nt_league_ids: NT_LEAGUE_IDS,
        p_org_id: activeOrgId,
      })
      .then(({ data }: { data: unknown }) => {
        if (!cancelled) setRemaining(Math.max(0, limit - ((data as number) ?? 0)));
      });
    return () => { cancelled = true; };
  }, [activeOrgId, activeOrgPlan, activeOrgIsPersonal]);

  return remaining;
}
