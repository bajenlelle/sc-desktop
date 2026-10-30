/**
 * Compact license notice for club orgs whose license expired (grace) or
 * locked. Mobile twin of the web/desktop app-shell LicenseBanner — mounted on
 * the feed and profile screens so players hear about expiry somewhere other
 * than a failed join.
 */
import { View } from "react-native";
import { getLicenseState, graceEndsAt } from "@scoutable/shared/lib/license-state";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { NoticeRow } from "@/components/ui/Row";

export function LicenseNotice({ className = "" }: { className?: string }) {
  const { myOrgs } = useAuth();

  const affected = myOrgs.filter((o) => {
    if (o.isPersonal) return false;
    // Staff only — players shouldn't be nagged about their club's renewals.
    if (o.role !== "admin" && o.role !== "coach") return false;
    const state = getLicenseState(o.expiresAt);
    return state === "grace" || state === "locked";
  });

  if (affected.length === 0) return null;

  return (
    <View className={className}>
      {affected.map((o) => {
        const state = getLicenseState(o.expiresAt);
        const graceEnd = graceEndsAt(o.expiresAt);
        // Status only, no renewal call to action: App Store 3.1.3(f) keeps
        // this app exempt from in-app purchase as long as it never points at
        // a purchase outside it. Web and desktop still carry the renewal path.
        return (
          <NoticeRow key={o.orgId} icon="error" tone="destructive">
            {state === "grace" && graceEnd
              ? `${o.orgName}'s license has expired. New shares pause on ${formatDate(graceEnd, "short")}; existing playlists stay watchable.`
              : `${o.orgName}'s license has expired. New shares are paused; existing playlists stay watchable.`}
          </NoticeRow>
        );
      })}
    </View>
  );
}
