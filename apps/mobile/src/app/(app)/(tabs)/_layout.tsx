import { Tabs } from "expo-router";
import { useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { themeColors } from "@/lib/theme";

/**
 * Bottom tabs: Playlists + Profile for everyone; My Highlights (the personal
 * space) only for player-only users — it's the players' second destination,
 * coaches keep their production flow. The watch screen (playlists/[id]) lives
 * OUTSIDE this group so playback pushes fullscreen over the tab bar.
 */
export default function TabsLayout() {
  const { isPlayerOnly, activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const scheme = useColorScheme();
  const colors = themeColors(scheme);

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
          title: isCoachOrAdmin ? "Shared" : "My Playlists",
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
