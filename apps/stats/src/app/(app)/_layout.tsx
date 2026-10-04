import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useThemeColors } from "@/lib/theme-context";
import { SessionsProvider } from "@/features/stat-keeper/store";

export default function AppLayout() {
  const { user, loading } = useAuth();
  const colors = useThemeColors();
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/sign-in" />;
  return (
    <SessionsProvider userId={user.id}>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionsProvider>
  );
}
