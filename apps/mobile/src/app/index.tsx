import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { consumePendingJoinCode } from "@/lib/pending-join";
import { useThemeColors } from "@/lib/theme-context";

/**
 * Route dispatcher — the mobile equivalent of web's proxy.ts middleware:
 * no session → sign-in; onboarding needed → onboarding; only personal
 * org(s) → no-org explainer; else → the playlist feed.
 */
export default function Index() {
  const { user, loading, profileLoading, needsOnboarding, myOrgs } = useAuth();
  const colors = useThemeColors();

  if (loading || (user && profileLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/sign-in" />;

  // A join deep link that arrived while signed out resumes here.
  const pendingJoin = consumePendingJoinCode();
  if (pendingJoin) return <Redirect href={`/join/${pendingJoin}`} />;

  if (needsOnboarding) return <Redirect href="/onboarding" />;
  if (myOrgs.length > 0 && myOrgs.every((o) => o.isPersonal)) return <Redirect href="/no-org" />;
  return <Redirect href="/playlists" />;
}
