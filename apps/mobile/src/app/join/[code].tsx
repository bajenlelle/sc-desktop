/**
 * Deep-link target for invite links: scoutable://join/CODE (and later the
 * app.scoutable.se/join/CODE universal link). Mobile port of web's
 * /join/[code] page: preview → join → land in the feed.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { getInvitePreview, joinByCode } from "@scoutable/shared/lib/profile-db";
import type { InviteInvalidReason } from "@scoutable/shared/types/org";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { successHaptic } from "@/lib/haptics";
import { setPendingJoinCode } from "@/lib/pending-join";
import { useThemeColors } from "@/lib/theme-context";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/EmptyState";
import { Text } from "@/components/ui/Text";

const INVALID_COPY: Record<InviteInvalidReason, string> = {
  not_found: "This invite link doesn't exist. Double-check the link or ask your coach for a new one.",
  expired_invite: "This invite has expired. Ask your coach for a new link.",
  exhausted: "This invite has already been used the maximum number of times.",
  // No renewal call to action on iOS — see the note in LicenseNotice.tsx.
  // The player can't act on it anyway; their coach handles it on the web.
  expired_license:
    "This organization's license has expired. Ask your coach to get in touch with us.",
  seat_limit_reached:
    "This organization has used all its seats for this role. The organization admin has been notified — ask them to free a seat or add more.",
};

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user, loading, setActiveOrg, reloadProfile } = useAuth();
  const colors = useThemeColors();
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
        successHaptic();
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

  if (error) {
    return (
      <StatusScreen
        icon="warning"
        title="Can't join"
        body={error}
        actions={<Button onPress={() => router.replace("/playlists")}>Go to my playlists</Button>}
      />
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
      <ActivityIndicator color={colors.mutedForeground} />
      <Text variant="callout" className="text-muted-foreground">
        {orgName ? `Joining ${orgName}…` : "Checking your invite…"}
      </Text>
    </View>
  );
}
