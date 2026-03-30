import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../components/auth-context";

export default function Index() {
  const { user, loading, profile, profileLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || profileLoading) return;
    if (!user) {
      router.replace("/(auth)/login");
      return;
    }
    if (!profile?.orgId) {
      router.replace("/(app)/onboarding");
      return;
    }
    router.replace("/(app)/playlists");
  }, [user, loading, profile, profileLoading]);

  return (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}
