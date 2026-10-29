import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, Platform, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { PlaylistsProvider } from "@/lib/playlists-store";
import { MyTeamProvider } from "@/lib/my-team";
import { DeviceGateScreen } from "@/components/DeviceGateScreen";
import { NotificationsBridge } from "@/components/NotificationsBridge";
import { useThemeColors } from "@/lib/theme-context";

const sheetOptions = {
  presentation: "formSheet",
  sheetAllowedDetents: "fitToContents",
  sheetGrabberVisible: Platform.OS === "ios",
  sheetCornerRadius: 14,
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
          {/* Short forms rise as native sheets over the screen they belong to. */}
          <Stack.Screen name="feedback" options={sheetOptions} />
          <Stack.Screen name="delete-account" options={sheetOptions} />
        </Stack>
      </PlaylistsProvider>
    </MyTeamProvider>
  );
}
