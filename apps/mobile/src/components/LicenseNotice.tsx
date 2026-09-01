/**
 * Compact license notice for club orgs whose license expired (grace) or
 * locked. Mobile twin of the web/desktop app-shell LicenseBanner — mounted on
 * the feed and profile screens so players hear about expiry somewhere other
 * than a failed join.
 */
import { Text, View } from "react-native";
import { getLicenseState, graceEndsAt } from "@scoutable/shared/lib/license-state";
import { useAuth } from "@/lib/auth-context";

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
    <View className={`gap-2 ${className}`}>
      {affected.map((o) => {
        const state = getLicenseState(o.expiresAt);
        const graceEnd = graceEndsAt(o.expiresAt)?.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <View
            key={o.orgId}
            className="rounded-xl border border-red-500/40 bg-red-500/5 px-3 py-2"
          >
            <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
              {o.orgName}&apos;s license has expired
            </Text>
            <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {state === "grace"
                ? `New shares pause on ${graceEnd} unless it's renewed. `
                : "New shares are paused — existing playlists stay watchable. "}
              {o.role === "admin"
                ? "Request a renewal from the web app."
                : "Ask your organization admin about renewal."}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
