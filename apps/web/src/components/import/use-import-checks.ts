"use client";

import { useCallback, useEffect, useState } from "react";
import {
  gameVideoBlock,
  gameVideoQuotaLabel,
  getGameVideoQuota,
  type GameVideoBlock,
  type GameVideoQuota,
} from "@scoutable/shared/lib/game-videos-db";
import { createClient } from "@/lib/supabase/client";

/** The space's import allowance as `get_import_quota` reports it; `limit` null = unlimited. */
export interface ImportQuotaView {
  tier: string;
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface ImportChecks {
  /** Both meters have answered (or failed). */
  loaded: boolean;
  importQuota: ImportQuotaView | null;
  /** The space has no imports left: new games can't be saved (re-imports can). */
  importBlocked: boolean;
  cloudQuota: GameVideoQuota | null;
  /** Why a new upload can't start, or null. */
  cloudBlock: GameVideoBlock | null;
  refresh: () => void;
}

/**
 * The two meters the import page checks before it lets a game in: the
 * space's import allowance and its cloud-game allowance. Pre-checks only:
 * the database's triggers are the real gates, and the function's `begin`
 * the cloud one, so a race surfaces the same way through their errors.
 */
export function useImportChecks(orgId: string | null): ImportChecks {
  const [state, setState] = useState<{ forOrg: string | null; importQuota: ImportQuotaView | null; cloudQuota: GameVideoQuota | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const importQuota = orgId
      ? supabase
          .rpc("get_import_quota", { p_org_id: orgId })
          .then(({ data, error }) => {
            if (error || !data) return null;
            const q = data as Record<string, unknown>;
            return {
              tier: String(q.tier ?? "free"),
              limit: q.limit === null || q.limit === undefined ? null : Number(q.limit),
              used: Number(q.used ?? 0),
              remaining: q.remaining === null || q.remaining === undefined ? null : Number(q.remaining),
            } satisfies ImportQuotaView;
          })
      : Promise.resolve(null);
    void Promise.all([importQuota, getGameVideoQuota(supabase, orgId)]).then(([iq, cq]) => {
      if (!cancelled) setState({ forOrg: orgId, importQuota: iq, cloudQuota: cq });
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const loaded = state !== null && state.forOrg === orgId;
  const importQuota = loaded ? state.importQuota : null;
  const cloudQuota = loaded ? state.cloudQuota : null;
  return {
    loaded,
    importQuota,
    importBlocked: !!importQuota && importQuota.limit !== null && (importQuota.remaining ?? 0) <= 0,
    cloudQuota,
    cloudBlock: loaded ? gameVideoBlock(cloudQuota) : null,
    refresh,
  };
}

/** "You've used all 3 free imports." / "You've used all 6 Rookie imports for this month." */
export function importLimitText(quota: ImportQuotaView | null): string {
  const limit = quota?.limit ?? 3;
  if (quota?.tier === "rookie") return `You've used all ${limit} Rookie imports for this month. They reset on the 1st.`;
  return `You've used all ${limit} free imports.`;
}

/** The cloud meter's block, as a sentence. */
export function cloudBlockText(block: GameVideoBlock, quota: GameVideoQuota | null): string {
  if (block === "limit_reached" && quota && quota.maxGames > 0) {
    return `You've used all ${quota.maxGames} cloud ${quota.maxGames === 1 ? "game" : "games"} on your plan.`;
  }
  return `${gameVideoQuotaLabel(quota)}.`;
}

/** "2 of 3 imports left", or null for an unlimited or unknown allowance. */
export function importQuotaLabel(quota: ImportQuotaView | null): string | null {
  if (!quota || quota.limit === null) return null;
  const left = Math.max(0, quota.remaining ?? quota.limit - quota.used);
  return `${left} of ${quota.limit} ${quota.limit === 1 ? "import" : "imports"} left`;
}
