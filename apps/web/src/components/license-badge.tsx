import { Badge } from "@/components/ui/badge";
import { daysUntilExpiry, getLicenseState } from "@scoutable/shared/lib/license-state";

/**
 * License expiry badge shared by the platform-admin org list and detail page.
 * States follow shared/lib/license-state.ts: no expiry → quiet, <30d → loud,
 * expired (grace or locked) → destructive.
 */
export function LicenseBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <Badge variant="secondary">No expiry</Badge>;

  const state = getLicenseState(expiresAt);
  if (state === "grace" || state === "locked") {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (state === "expiring") {
    const days = daysUntilExpiry(expiresAt) ?? 0;
    return <Badge variant="default">Expires in {days}d</Badge>;
  }
  return (
    <Badge variant="secondary">
      {new Date(expiresAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
    </Badge>
  );
}
