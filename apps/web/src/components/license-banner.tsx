"use client";

/**
 * The expired-license notice: opens every page while the ACTIVE club's
 * license has expired (grace) or the grace period has passed (locked).
 * Before this, the only expired-license signal lived on /organization — a
 * page coaches and players rarely visit. PageContent renders it, so it sits
 * under each page's toolbar at the content's measure.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { useAuth } from "@/components/auth-context";
import { requestLicenseRenewal } from "@/lib/profile-db";
import { formatDate } from "@/lib/format-date";
import { getLicenseState, graceEndsAt } from "@scoutable/shared/lib/license-state";

export function LicenseBanner({ className }: { className?: string }) {
  const { activeOrg } = useAuth();
  const [requesting, setRequesting] = useState(false);
  // Persistent inline confirmation — a transient toast alone is easy to miss.
  const [requested, setRequested] = useState(false);

  if (!activeOrg || activeOrg.isPersonal) return null;
  // License admin is a staff concern — players just keep watching what's
  // already shared and shouldn't be nagged about renewals.
  if (activeOrg.role !== "admin" && activeOrg.role !== "coach") return null;
  const state = getLicenseState(activeOrg.expiresAt);
  if (state !== "grace" && state !== "locked") return null;

  const isAdmin = activeOrg.role === "admin";
  const graceEnd = graceEndsAt(activeOrg.expiresAt);
  const graceEndLabel = graceEnd ? formatDate(graceEnd) : null;

  async function handleRequestRenewal() {
    if (!activeOrg) return;
    setRequesting(true);
    try {
      await requestLicenseRenewal(activeOrg.orgId);
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
    <Callout
      tone="destructive"
      icon={<AlertTriangle />}
      className={className}
      action={
        isAdmin ? (
          requested ? (
            <span className="flex items-center gap-1 text-callout text-muted-foreground">
              <Check className="size-3.5 text-success" />
              Renewal requested
            </span>
          ) : (
            <Button size="xs" variant="outline" disabled={requesting} onClick={handleRequestRenewal}>
              {requesting && <Loader2 className="animate-spin" />}
              Request renewal
            </Button>
          )
        ) : undefined
      }
    >
      <p className="font-medium text-foreground">{activeOrg.orgName}&apos;s license has expired</p>
      <p className="text-muted-foreground">
        {state === "grace"
          ? `Importing, sharing and invites pause on ${graceEndLabel} unless it's renewed.`
          : "Importing, sharing and invites are paused. Existing playlists stay watchable."}
        {!isAdmin && " Ask your club's admin about renewing."}
      </p>
    </Callout>
  );
}
