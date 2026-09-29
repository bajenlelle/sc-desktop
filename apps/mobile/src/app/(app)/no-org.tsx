import { Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { signOutAndCleanup } from "@/lib/notifications";
import { Button } from "@/components/Button";

/**
 * Where every account without a club lands. Every account has a personal
 * space, so a no-club user always reaches this screen, never /onboarding.
 *
 * This is the proof App Review asked for on the 2026-09-29 call: the app is
 * for club members, and an individual account (free, Rookie or Pro) must see a
 * screen that clearly says its Scoutable lives in the desktop app. It stays
 * the same for all of them. Branching on plan tier would unlock a screen on
 * the strength of a web purchase (3.1.1). No plan names, prices or links
 * either: anywhere on scoutable.se is two taps from the price list.
 */
export default function NoOrg() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center px-6">
        <Text className="font-heading text-4xl text-foreground">
          This app is for club members
        </Text>
        <Text className="mt-2 text-base text-muted-foreground">
          It shows the playlists your club shares with you.
        </Text>
        <Text className="mt-4 text-base text-muted-foreground">
          Using Scoutable on your own? Your games, playlists and highlights are in the Scoutable
          desktop app for Mac and Windows.
        </Text>
        <Text className="mt-4 text-base text-muted-foreground">
          Joining a club? Ask your coach for an invite code.
        </Text>
        <View className="mt-8 gap-3">
          <Button title="I have an invite code" onPress={() => router.push("/onboarding")} />
          <Button title="Sign out" variant="ghost" onPress={() => signOutAndCleanup()} />
        </View>
      </View>
    </SafeAreaView>
  );
}
