import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { getOrgImportLimit, type ImportQuota } from "@scoutable/shared/lib/plan-tier";

/**
 * Import allowance in the active personal space, straight from the
 * `get_import_quota` RPC — the server owns the numbers (tier base + any
 * campaign grants), the client only displays them.
 *
 * Returns `null` when the quota is irrelevant or unknown — an unlimited tier,
 * a team space (plan is admin-managed there), or the RPC hasn't answered yet.
 * Callers render a plain tier chip in that case, so the chip paints
 * immediately and gains the quota once the numbers arrive.
 */
export function useImportQuota(): ImportQuota | null {
  const { activeOrgId, activeOrgPlan, activeOrgIsPersonal } = useAuth();
  const [quota, setQuota] = useState<ImportQuota | null>(null);

  useEffect(() => {
    // Display fallback gate: unlimited tiers never fetch.
    if (!activeOrgIsPersonal || getOrgImportLimit(activeOrgPlan) === null || !activeOrgId) {
      setQuota(null);
      return;
    }
    let cancelled = false;
    const refetch = () => {
      createClient()
        .rpc("get_import_quota", { p_org_id: activeOrgId })
        .then(({ data, error }) => {
          if (cancelled || error || !data) {
            if (!cancelled) setQuota(null);
            return;
          }
          const q = data as Record<string, unknown>;
          if (q.limit === null || q.limit === undefined) {
            setQuota(null); // server says unlimited — trust it over the fallback
            return;
          }
          setQuota({
            tier: q.tier as ImportQuota["tier"],
            window: q.window as ImportQuota["window"],
            baseLimit: q.base_limit as number,
            bonus: (q.bonus as number) ?? 0,
            limit: q.limit as number,
            used: q.used as number,
            remaining: q.remaining as number,
          });
        });
    };
    refetch();
    // The badge outlives every page (it sits in the persistent header), so it
    // re-counts whenever an import or delete changes the total.
    window.addEventListener("matches-changed", refetch);
    return () => {
      cancelled = true;
      window.removeEventListener("matches-changed", refetch);
    };
  }, [activeOrgId, activeOrgPlan, activeOrgIsPersonal]);

  return quota;
}
