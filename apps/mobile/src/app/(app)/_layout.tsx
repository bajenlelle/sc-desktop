import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { PlaylistsProvider } from "@/lib/playlists-store";
import { DeviceGateScreen } from "@/components/DeviceGateScreen";
import { NotificationsBridge } from "@/components/NotificationsBridge";
import { useThemeColors } from "@/lib/theme-context";

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
    <PlaylistsProvider>
      <NotificationsBridge />
      <Stack screenOptions={{ headerShown: false }} />
    </PlaylistsProvider>
  );
}
