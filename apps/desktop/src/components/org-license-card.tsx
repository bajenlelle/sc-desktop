/**
 * Admin-facing license card on the organization page. Desktop twin of
 * apps/web/src/components/org-license-card.tsx — remaining-oriented seat
 * usage, expiry warning states, and a "Request renewal" action.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestLicenseRenewal } from "@/lib/profile-db";
import {
  daysUntilExpiry,
  getLicenseState,
  seatsLeftLabel,
  seatsRunningLow,
} from "@scoutable/shared/lib/license-state";

interface OrgLicenseCardProps {
  orgId: string;
  coachSeatLimit: number | null;
  playerSeatLimit: number | null;
  expiresAt: string | null;
  coachCount: number;
  playerCount: number;
}

export function OrgLicenseCard({
  orgId,
  coachSeatLimit,
  playerSeatLimit,
  expiresAt,
  coachCount,
  playerCount,
}: OrgLicenseCardProps) {
  const [requesting, setRequesting] = useState(false);

  if (coachSeatLimit == null && playerSeatLimit == null && expiresAt == null) return null;

  const state = getLicenseState(expiresAt);
  const days = daysUntilExpiry(expiresAt);
  const expired = state === "grace" || state === "locked";
  const coachLabel = seatsLeftLabel(coachCount, coachSeatLimit, "coach");
  const playerLabel = seatsLeftLabel(playerCount, playerSeatLimit, "player");

  async function handleRequestRenewal() {
    setRequesting(true);
    try {
      await requestLicenseRenewal(orgId);
      toast.success("Renewal requested — we'll be in touch.");
    } catch (e) {
      if ((e as Error).message === "renewal_already_requested") {
        toast.info("Renewal already requested — we're on it.");
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm ${
        expired
          ? "border-destructive/40 bg-destructive/5"
          : state === "expiring"
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-medium text-foreground">License</span>
        {coachLabel && (
          <span
            className={
              seatsRunningLow(coachCount, coachSeatLimit)
                ? "text-amber-600 dark:text-amber-500 font-medium"
                : "text-muted-foreground"
            }
          >
            {coachLabel}
          </span>
        )}
        {playerLabel && (
          <span
            className={
              seatsRunningLow(playerCount, playerSeatLimit)
                ? "text-amber-600 dark:text-amber-500 font-medium"
                : "text-muted-foreground"
            }
          >
            {playerLabel}
          </span>
        )}
        {expiresAt && (
          <span
            className={
              expired
                ? "text-destructive font-medium"
                : state === "expiring"
                  ? "text-amber-600 dark:text-amber-500 font-medium"
                  : "text-muted-foreground"
            }
          >
            {expired
              ? "Expired"
              : state === "expiring"
                ? `Expires in ${days} day${days === 1 ? "" : "s"}`
                : `Expires ${new Date(expiresAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}`}
          </span>
        )}
        {(expired || state === "expiring") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={requesting}
            onClick={handleRequestRenewal}
          >
            {requesting ? "Requesting…" : "Request renewal"}
          </Button>
        )}
      </div>
      {expired && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {state === "grace"
            ? "Inviting new members is paused. Sharing and team changes pause when the grace period ends — existing members keep watching."
            : "Inviting, sharing, and team changes are paused until the license is renewed. Existing playlists stay watchable."}
        </p>
      )}
    </div>
  );
}
