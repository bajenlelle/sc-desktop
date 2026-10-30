import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, Platform, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { PlaylistsProvider } from "@/lib/playlists-store";
import { MyTeamProvider } from "@/lib/my-team";
import { DeviceGateScreen } from "@/components/DeviceGateScreen";
import { NotificationsBridge } from "@/components/NotificationsBridge";
import { useThemeColors } from "@/lib/theme-context";

/**
 * Settings rise as a sheet that covers almost the whole screen, as Claude's
 * do: on iOS the native page sheet (the app scales back behind it, a swipe
 * down puts it away); on Android a full-screen page sliding up, Material's
 * full-screen dialog. Its pages push inside it.
 */
const settingsOptions = {
  presentation: "modal",
  animation: Platform.OS === "android" ? "slide_from_bottom" : "default",
} as const;

export default function AppLayout() {
  const { user, loading, deviceBlocked } = useAuth();
  const colors = useThemeColors();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/sign-in" />;
  if (deviceBlocked) return <DeviceGateScreen />;
  return (
    <MyTeamProvider>
      <PlaylistsProvider>
        <NotificationsBridge />
        <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: "minimal" }}>
          <Stack.Screen name="profile" options={settingsOptions} />
        </Stack>
      </PlaylistsProvider>
    </MyTeamProvider>
  );
}
