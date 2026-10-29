import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs, router } from "expo-router";
import { feedCounts } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { syncAppBadge } from "@/lib/notifications";
import { offerTeamStepOnce, useMyTeam } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { needsTeamStep, teamRoleIn } from "@scoutable/shared/lib/league-teams";
import { useThemeColors } from "@/lib/theme-context";
import { ShellProvider } from "@/components/shell/ShellContext";
import { TabBar, type TabItem } from "@/components/shell/TabBar";
import { TAB_BAR_H } from "@/lib/layout";

/**
 * The app's own tab bar (components/shell/TabBar), the same on iOS and
 * Android, as the web's phone layout draws it: Playlists and Profile for
 * everyone, My highlights (the personal space) for player-only users. Each
 * tab is its own stack. The watch screen (playlists/[id]), /team and the
 * sheets live OUTSIDE this group, so they cover the tab bar.
 *
 * Whether My highlights shows is decided once, when the first profile has
 * settled, and then kept: a later reload (a staff club switch reloads the
 * profile) never flips the bar under the user's finger.
 */
export default function TabsLayout() {
  const { isPlayerOnly, activeOrgRole, activeOrg, profile, profileLoading } = useAuth();
  const { choices, loaded: teamsLoaded } = useMyTeam();
  const { feedItems, loading } = usePlaylists();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const [playerOnlyLatch, setPlayerOnlyLatch] = useState<boolean | null>(null);
  useEffect(() => {
    if (playerOnlyLatch === null && !profileLoading && profile) setPlayerOnlyLatch(isPlayerOnly);
  }, [playerOnlyLatch, profileLoading, profile, isPlayerOnly]);

  // Fully-unwatched playlists: same semantics as the feed's "New" filter
  // (both derive from the store's shared feedItems).
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);
  const playlistsTitle = isCoachOrAdmin ? "Shared playlists" : "My playlists";

  // App-icon badge mirrors the tab badge. The !loading guard stops the
  // initial fetch from flashing the icon count to 0.
  useEffect(() => {
    if (!loading) syncAppBadge(newCount);
  }, [newCount, loading]);

  // "Which team do you play for?" once per club space: shown over the tabs
  // until answered (skip counts), at most once per launch.
  const declaredRole = profile?.declaredRole;
  useEffect(() => {
    if (!activeOrg || activeOrg.isNtOrg || !teamsLoaded) return;
    if (!needsTeamStep(choices, activeOrg.orgId) || !offerTeamStepOnce(activeOrg.orgId)) return;
    trackEvent("team_step_shown", { role: teamRoleIn(activeOrg, declaredRole) });
    router.push({ pathname: "/team", params: { mode: "step", orgId: activeOrg.orgId } });
  }, [activeOrg, teamsLoaded, choices, declaredRole]);

  if (playerOnlyLatch === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  const items: TabItem[] = [
    { name: "playlists", title: playlistsTitle, icon: isCoachOrAdmin ? "sharedPlaylists" : "playlists", badge: newCount },
    ...(playerOnlyLatch ? [{ name: "highlights", title: "My highlights", icon: "highlights" } as TabItem] : []),
    { name: "profile", title: "Profile", icon: "profile" },
  ];

  return (
    <ShellProvider tabBarHeight={TAB_BAR_H + insets.bottom}>
      <Tabs
        tabBar={(props) => <TabBar {...props} items={items} />}
        screenOptions={{
          headerShown: false,
          animation: "none",
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen name="playlists" />
        <Tabs.Screen name="highlights" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </ShellProvider>
  );
}
