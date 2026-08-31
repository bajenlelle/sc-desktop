/**
 * App-shell license banner: shows on every page when the ACTIVE org's license
 * has expired (grace) or the grace period has passed (locked). Desktop twin
 * of apps/web/src/components/license-banner.tsx.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { requestLicenseRenewal } from "@/lib/profile-db";
import { getLicenseState, graceEndsAt } from "@scoutable/shared/lib/license-state";

export function LicenseBanner() {
  const { activeOrg } = useAuth();
  const [requesting, setRequesting] = useState(false);
  // Persistent inline confirmation — a transient toast alone is easy to miss.
  const [requested, setRequested] = useState(false);

  if (!activeOrg || activeOrg.isPersonal) return null;
  const state = getLicenseState(activeOrg.expiresAt);
  if (state !== "grace" && state !== "locked") return null;

  const isAdmin = activeOrg.role === "admin";
  const graceEnd = graceEndsAt(activeOrg.expiresAt);
  const graceEndLabel = graceEnd?.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  async function handleRequestRenewal() {
    if (!activeOrg) return;
    setRequesting(true);
    try {
      await requestLicenseRenewal(activeOrg.orgId);
      setRequested(true);
      toast.success("Renewal requested — we'll be in touch.");
    } catch (e) {
      if ((e as Error).message === "renewal_already_requested") {
        setRequested(true);
        toast.info("Renewal already requested — we're on it.");
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="border-b border-destructive/40 bg-destructive/5 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="font-medium text-destructive">
          {activeOrg.orgName}&apos;s license has expired
        </span>
        <span className="text-muted-foreground">
          {state === "grace"
            ? `Sharing and invites pause on ${graceEndLabel} unless it's renewed.`
            : "Sharing and invites are paused. Existing playlists stay watchable."}
        </span>
        {isAdmin ? (
          requested ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-500">
              Renewal requested — we&apos;ll be in touch
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={requesting}
              onClick={handleRequestRenewal}
            >
              {requesting ? "Requesting…" : "Request renewal"}
            </Button>
          )
        ) : (
          <span className="text-xs text-muted-foreground">
            Ask your organization admin about renewal.
          </span>
        )}
      </div>
    </div>
  );
}
