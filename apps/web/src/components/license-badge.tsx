import { Badge } from "@/components/ui/badge";
import { daysUntilExpiry, getLicenseState } from "@scoutable/shared/lib/license-state";
import { formatDate } from "@/lib/format-date";

/**
 * License expiry badge shared by the platform-admin org list and detail page.
 * States follow shared/lib/license-state.ts: no expiry → quiet, <30d →
 * a warning, expired (grace or locked) → destructive.
 */
export function LicenseBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <Badge variant="secondary">No expiry</Badge>;

  const state = getLicenseState(expiresAt);
  if (state === "grace" || state === "locked") {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (state === "expiring") {
    const days = daysUntilExpiry(expiresAt) ?? 0;
    return <Badge variant="warning">{days === 1 ? "1 day left" : `${days} days left`}</Badge>;
  }
  return <Badge variant="secondary">Until {formatDate(expiresAt)}</Badge>;
}
