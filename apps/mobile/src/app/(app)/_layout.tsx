import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View, useColorScheme } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { PlaylistsProvider } from "@/lib/playlists-store";
import { DeviceGateScreen } from "@/components/DeviceGateScreen";
import { NotificationsBridge } from "@/components/NotificationsBridge";
import { themeColors } from "@/lib/theme";

export default function AppLayout() {
  const { user, loading, deviceBlocked } = useAuth();
  const scheme = useColorScheme();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background dark:bg-background-dark">
        <ActivityIndicator size="large" color={themeColors(scheme).primary} />
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
