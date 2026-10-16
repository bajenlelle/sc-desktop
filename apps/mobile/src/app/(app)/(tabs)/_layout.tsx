import { useEffect, useMemo } from "react";
import { Tabs, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { feedCounts } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { syncAppBadge } from "@/lib/notifications";
import { offerTeamStepOnce, useMyTeam } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { needsTeamStep, teamRoleIn } from "@scoutable/shared/lib/league-teams";
import { useThemeColors } from "@/lib/theme-context";

/**
 * Bottom tabs: Playlists + Profile for everyone; My Highlights (the personal
 * space) only for player-only users — it's the players' second destination,
 * coaches keep their production flow. The watch screen (playlists/[id]) lives
 * OUTSIDE this group so playback pushes fullscreen over the tab bar.
 */
export default function TabsLayout() {
  const { isPlayerOnly, activeOrgRole, activeOrg, profile } = useAuth();
  const { choices, loaded: teamsLoaded } = useMyTeam();
  const { feedItems, loading } = usePlaylists();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const colors = useThemeColors();

  // Fully-unwatched playlists — same semantics as the feed's "New" chip
  // (guaranteed: both derive from the store's shared feedItems).
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);
  const playlistsTitle = isCoachOrAdmin ? "Shared" : "My Playlists";

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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="playlists/index"
        options={{
          title: playlistsTitle,
          // 0 renders an empty badge — must be undefined when clear.
          tabBarBadge: newCount > 0 ? newCount : undefined,
          tabBarAccessibilityLabel:
            newCount > 0 ? `${playlistsTitle}, ${newCount} new` : playlistsTitle,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="highlights"
        options={{
          href: isPlayerOnly ? "/highlights" : null,
          title: "My Highlights",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sparkles-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
