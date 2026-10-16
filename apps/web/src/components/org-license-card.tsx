"use client";

/**
 * Admin-facing license card on /organization: remaining-oriented seat usage
 * (house convention: "2 of 10 coach seats left"), expiry with warning states,
 * and a "Request renewal" action that notifies Scoutable — replacing the old
 * one-line strip that had no warning threshold and no way to act.
 */
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { ProgressBar } from "@/components/ui/progress-bar";
import { requestLicenseRenewal } from "@/lib/profile-db";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
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

function SeatRow({ label, used, limit, kind }: { label: string; used: number; limit: number; kind: "coach" | "player" }) {
  const low = seatsRunningLow(used, limit);
  return (
    // One line from sm; on a phone the bar takes its own line under the label.
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 sm:flex-nowrap">
      <span className="flex-1 text-sm sm:w-32 sm:flex-none sm:shrink-0">{label}</span>
      <ProgressBar
        percent={limit > 0 ? (used / limit) * 100 : 0}
        className="order-last h-1.5 w-full sm:order-none sm:w-auto sm:flex-1"
        fillClassName={low ? "bg-warning" : undefined}
      />
      <span className={cn("shrink-0 text-right text-callout nums sm:w-36", low ? "font-medium text-warning" : "text-muted-foreground")}>
        {seatsLeftLabel(used, limit, kind)}
      </span>
    </div>
  );
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
  // Persistent inline confirmation: a toast alone is easy to miss.
  const [requested, setRequested] = useState(false);

  if (coachSeatLimit == null && playerSeatLimit == null && expiresAt == null) return null;

  const state = getLicenseState(expiresAt);
  const days = daysUntilExpiry(expiresAt);
  const expired = state === "grace" || state === "locked";

  async function handleRequestRenewal() {
    setRequesting(true);
    try {
      await requestLicenseRenewal(orgId);
      setRequested(true);
      toast.success("Renewal requested. We'll be in touch.");
    } catch (e) {
      if ((e as Error).message === "renewal_already_requested") {
        setRequested(true);
        toast.info("Renewal already requested. We're on it.");
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section>
      <GroupHeader title="Plan and seats" />
      <GroupedList>
        {coachSeatLimit != null && <SeatRow label="Coach seats" used={coachCount} limit={coachSeatLimit} kind="coach" />}
        {playerSeatLimit != null && <SeatRow label="Player seats" used={playerCount} limit={playerSeatLimit} kind="player" />}
        {expiresAt && (
          <div className={cn("flex min-h-11 items-center gap-4 px-4 py-2", expired && "bg-destructive/6", state === "expiring" && "bg-warning/8")}>
            <span className="shrink-0 text-sm sm:w-32">License</span>
            <span
              className={cn(
                "flex-1 text-callout nums",
                expired ? "font-medium text-destructive" : state === "expiring" ? "font-medium text-warning" : "text-muted-foreground",
              )}
            >
              {expired
                ? "Expired"
                : state === "expiring"
                  ? `Expires in ${days} day${days === 1 ? "" : "s"}`
                  : `Expires ${formatDate(expiresAt)}`}
            </span>
            {(expired || state === "expiring") &&
              (requested ? (
                <span className="flex items-center gap-1 text-callout text-muted-foreground">
                  <Check className="size-3.5 text-success" />
                  Renewal requested
                </span>
              ) : (
                <Button size="xs" variant="outline" disabled={requesting} onClick={handleRequestRenewal}>
                  {requesting && <Loader2 className="animate-spin" />}
                  Request renewal
                </Button>
              ))}
          </div>
        )}
      </GroupedList>
      {expired && (
        <GroupFooter>
          {state === "grace"
            ? "Inviting new members is paused. Importing, sharing and team changes pause when the grace period ends; existing members keep watching."
            : "Inviting, importing, sharing and team changes are paused until the license is renewed. Existing playlists stay watchable."}
        </GroupFooter>
      )}
    </section>
  );
}
