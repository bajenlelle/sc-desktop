import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { feedCounts } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { syncAppBadge } from "@/lib/notifications";
import { offerTeamStepOnce, useMyTeam } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { needsTeamStep, teamRoleIn } from "@scoutable/shared/lib/league-teams";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { Sidebar } from "@/components/shell/Sidebar";

/**
 * The app's root destinations behind a sidebar, as Claude's app: the screen
 * fills the window, a menu button (or a swipe from the left edge) slides the
 * sidebar in beside it, and the screen slides along under a dimmed overlay.
 * The same on iOS and Android. The routes are the tab routes they always
 * were (playlists, highlights, profile), each its own stack, so every path,
 * deep link and notification target is unchanged. The watch screen, /team
 * and the sheets live OUTSIDE this group, so they cover the sidebar too.
 *
 * Whether My highlights shows is decided once, when the first profile has
 * settled, and then kept: a later reload (a staff club switch reloads the
 * profile) never changes the sidebar under the user's finger.
 */
export default function TabsLayout() {
  const { isPlayerOnly, activeOrg, profile, profileLoading } = useAuth();
  const { choices, loaded: teamsLoaded } = useMyTeam();
  const { feedItems, loading } = usePlaylists();
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const { width } = useWindowDimensions();

  const [playerOnlyLatch, setPlayerOnlyLatch] = useState<boolean | null>(null);
  useEffect(() => {
    if (playerOnlyLatch === null && !profileLoading && profile) setPlayerOnlyLatch(isPlayerOnly);
  }, [playerOnlyLatch, profileLoading, profile, isPlayerOnly]);

  // Fully-unwatched playlists: same semantics as the feed's "New" filter
  // (both derive from the store's shared feedItems).
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);

  // App-icon badge mirrors the sidebar's count. The !loading guard stops the
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

  return (
    <Drawer
      drawerContent={(props) => <Sidebar {...props} playerOnly={playerOnlyLatch} />}
      screenOptions={{
        headerShown: false,
        drawerType: "slide",
        drawerStyle: { width: Math.min(Math.round(width * 0.82), 360), backgroundColor: colors.background },
        overlayColor: resolvedMode === "dark" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)",
        overlayAccessibilityLabel: "Close menu",
        swipeEdgeWidth: 40,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Drawer.Screen name="playlists" />
      <Drawer.Screen name="highlights" />
      <Drawer.Screen name="profile" />
    </Drawer>
  );
}
