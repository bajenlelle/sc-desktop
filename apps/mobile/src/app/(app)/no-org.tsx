import { Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { signOutAndCleanup } from "@/lib/notifications";
import { Button } from "@/components/Button";

/**
 * Mobile equivalent of web's /get-started for personal-only users — but a
 * phone can't run the desktop editor, so the pitch is "get invited".
 */
export default function NoOrg() {
  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-1 justify-center px-6">
        <Text className="font-heading text-4xl text-foreground dark:text-foreground-dark">
          Almost there
        </Text>
        <Text className="mt-2 text-base text-muted-foreground dark:text-muted-foreground-dark">
          Scoutable for players works through your club. Ask your coach for an invite code — once
          you join, the playlists they share will show up here.
        </Text>
        <View className="mt-8 gap-3">
          <Button title="I have an invite code" onPress={() => router.push("/onboarding")} />
          <Button title="Sign out" variant="ghost" onPress={() => signOutAndCleanup()} />
        </View>
      </View>
    </SafeAreaView>
  );
}
