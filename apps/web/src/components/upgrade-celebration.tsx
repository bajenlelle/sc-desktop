"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { markPlanCelebrated } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { orgPlanLabel } from "@scoutable/shared/lib/plan-tier";
import { springs } from "@/lib/motion";

/** Only paid tiers rank above free; franchise is org licensing, never Stripe. */
const TIER_RANK: Record<string, number> = { free: 0, rookie: 1, pro: 2 };

const TIER_PERKS: Record<"rookie" | "pro", string[]> = {
  rookie: ["Export playlists as MP4", "6 game imports per month"],
  pro: ["Unlimited game imports", "Export playlists as MP4"],
};

/**
 * One-time "thanks for upgrading" moment. Shows when the user's personal org
 * tier outranks the tier they were last celebrated for
 * (profiles.celebrated_plan_tier) — which covers both "returned to the tab
 * right after paying" (via the auth context's upgrade poll) and "paid, then
 * opened the app the next day". Marked as celebrated the moment it opens, so
 * the desktop app / other devices never repeat it.
 */
export function UpgradeCelebration() {
  const { profile, profileLoading, myOrgs } = useAuth();
  const [tier, setTier] = useState<"rookie" | "pro" | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || profileLoading || !profile) return;
    const personal = myOrgs.find((o) => o.isPersonal);
    if (!personal) return;
    const current = personal.planTier;
    if (current !== "rookie" && current !== "pro") return;
    const celebrated = profile.celebratedPlanTier ?? "free";
    if ((TIER_RANK[current] ?? 0) <= (TIER_RANK[celebrated] ?? 0)) return;

    firedRef.current = true;
    setTier(current);
    trackEvent("plan_upgraded", { plan: current });
    // Write immediately (not on dismiss) so a second open client can't
    // double-show. Best effort — failing just risks one repeat later.
    markPlanCelebrated(current).catch((err) =>
      console.error("[celebration] failed to persist:", err),
    );
  }, [profile, profileLoading, myOrgs]);

  if (!tier) return null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) setTier(null); }}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center text-center">
          {/* The one moment in the app that earns a little overshoot. */}
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...springs.settle, delay: 0.12 }}
            className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Check className="size-7 stroke-[3]" />
          </motion.span>
          <DialogHeader className="items-center text-center">
            <DialogTitle>You&apos;re on {orgPlanLabel(tier)}</DialogTitle>
            <DialogDescription>Thanks for upgrading. Here&apos;s what&apos;s yours now:</DialogDescription>
          </DialogHeader>
          <ul className="mt-4 flex flex-col gap-2 self-center text-left">
            {TIER_PERKS[tier].map((perk) => (
              <li key={perk} className="flex items-center gap-2 text-sm text-foreground">
                <Check className="size-4 shrink-0 text-primary" />
                {perk}
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="sm:justify-center">
          <Button className="w-full" onClick={() => setTier(null)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
