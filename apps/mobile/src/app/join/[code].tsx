/**
 * Deep-link target for invite links: scoutable://join/CODE (and later the
 * app.scoutable.se/join/CODE universal link). Mobile port of web's
 * /join/[code] page: preview → join → land in the feed.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View, useColorScheme } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getInvitePreview, joinByCode } from "@scoutable/shared/lib/profile-db";
import type { InviteInvalidReason } from "@scoutable/shared/types/org";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { setPendingJoinCode } from "@/lib/pending-join";
import { themeColors } from "@/lib/theme";
import { Button } from "@/components/Button";

const INVALID_COPY: Record<InviteInvalidReason, string> = {
  not_found: "This invite link doesn't exist. Double-check the link or ask your coach for a new one.",
  expired_invite: "This invite has expired. Ask your coach for a new link.",
  exhausted: "This invite has already been used the maximum number of times.",
  // Same guidance as web: renewal goes through the org, not the player.
  expired_license:
    "This organization's license has expired. The organization can request a renewal from Scoutable.",
  seat_limit_reached:
    "This organization has used all its seats for this role. The organization admin has been notified — ask them to free a seat or add more.",
};

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user, loading, setActiveOrg, reloadProfile } = useAuth();
  const scheme = useColorScheme();
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  const normalized = typeof code === "string" ? code.toUpperCase() : "";

  useEffect(() => {
    if (loading || !user || !normalized) return;
    let cancelled = false;
    (async () => {
      try {
        const preview = await getInvitePreview(supabase, normalized).catch(() => null);
        if (cancelled) return;
        if (preview && !preview.valid) {
          setError(INVALID_COPY[preview.reason ?? "not_found"] ?? INVALID_COPY.not_found);
          return;
        }
        if (preview?.orgName) setOrgName(preview.orgName);
        const result = await joinByCode(supabase, normalized);
        if (cancelled) return;
        trackEvent("org_joined", { org_id: result.orgId });
        setActiveOrg(result.orgId);
        await reloadProfile();
        router.replace("/playlists");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to join");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id, normalized]);

  if (!loading && !user) {
    // Resume the join right after sign-in (index gate consumes the stash).
    if (normalized) setPendingJoinCode(normalized);
    return <Redirect href="/sign-in" />;
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-1 items-center justify-center gap-4 px-6">
        {error ? (
          <>
            <Text className="text-center font-heading text-3xl text-foreground dark:text-foreground-dark">
              Can&apos;t join
            </Text>
            <Text className="text-center text-base text-muted-foreground dark:text-muted-foreground-dark">
              {error}
            </Text>
            <Button title="Go to my playlists" onPress={() => router.replace("/playlists")} />
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={themeColors(scheme).primary} />
            <Text className="text-base text-muted-foreground dark:text-muted-foreground-dark">
              {orgName ? `Joining ${orgName}…` : "Checking your invite…"}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
