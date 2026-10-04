import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useThemeColors } from "@/lib/theme-context";

/** No session → sign in; otherwise the games list. */
export default function Index() {
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
  return <Redirect href="/games" />;
}
