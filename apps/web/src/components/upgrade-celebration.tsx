"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { markPlanCelebrated } from "@/lib/profile-db";
import { orgPlanLabel, orgPlanColors } from "@scoutable/shared/lib/plan-tier";
import { cn } from "@/lib/utils";

/** Only paid tiers rank above free; franchise is org licensing, never Stripe. */
const TIER_RANK: Record<string, number> = { free: 0, rookie: 1, pro: 2 };

const TIER_PERKS: Record<"rookie" | "pro", string[]> = {
  rookie: ["Export playlists as MP4", "10 game imports per month"],
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
    // Write immediately (not on dismiss) so a second open client can't
    // double-show. Best effort — failing just risks one repeat later.
    markPlanCelebrated(current).catch((err) =>
      console.error("[celebration] failed to persist:", err),
    );
  }, [profile, profileLoading, myOrgs]);

  if (!tier) return null;

  const colors = orgPlanColors(tier);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) setTier(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className={cn("mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-2xl", colors.badge)}>
            🎉
          </div>
          <DialogTitle className="text-center">
            You&apos;re on {orgPlanLabel(tier)} now!
          </DialogTitle>
          <DialogDescription className="text-center">
            Thanks for upgrading — here&apos;s what you&apos;ve unlocked:
          </DialogDescription>
        </DialogHeader>
        <ul className="mx-auto flex flex-col gap-2 py-1">
          {TIER_PERKS[tier].map((perk) => (
            <li key={perk} className="flex items-center gap-2 text-sm text-foreground">
              <Check className="h-4 w-4 shrink-0 text-primary" />
              {perk}
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-center">
          <Button className="w-full" onClick={() => setTier(null)}>
            Let&apos;s go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
