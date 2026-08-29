import { useEffect, useMemo } from "react";
import { Tabs } from "expo-router";
import { useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { feedCounts } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { syncAppBadge } from "@/lib/notifications";
import { themeColors } from "@/lib/theme";

/**
 * Bottom tabs: Playlists + Profile for everyone; My Highlights (the personal
 * space) only for player-only users — it's the players' second destination,
 * coaches keep their production flow. The watch screen (playlists/[id]) lives
 * OUTSIDE this group so playback pushes fullscreen over the tab bar.
 */
export default function TabsLayout() {
  const { isPlayerOnly, activeOrgRole } = useAuth();
  const { feedItems, loading } = usePlaylists();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const scheme = useColorScheme();
  const colors = themeColors(scheme);

  // Fully-unwatched playlists — same semantics as the feed's "New" chip
  // (guaranteed: both derive from the store's shared feedItems).
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);
  const playlistsTitle = isCoachOrAdmin ? "Shared" : "My Playlists";

  // App-icon badge mirrors the tab badge. The !loading guard stops the
  // initial fetch from flashing the icon count to 0.
  useEffect(() => {
    if (!loading) syncAppBadge(newCount);
  }, [newCount, loading]);

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
