import { View } from "react-native";
import { router } from "expo-router";
import { signOutAndCleanup } from "@/lib/notifications";
import { AuthShell } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";

/**
 * Where every account without a club lands. Every account has a personal
 * space, so a no-club user always reaches this screen, never /onboarding.
 *
 * This is the proof App Review asked for on the 2026-09-29 call: the app is
 * for club members, and an individual account (free, Rookie or Pro) must see a
 * screen that clearly says its Scoutable lives in the desktop app. It stays
 * the same for all of them. Branching on plan tier would unlock a screen on
 * the strength of a web purchase (3.1.1). No plan names, prices or links
 * either: anywhere on scoutable.se is two taps from the price list. The copy
 * is exactly what App Review saw; restyle it, don't reword it.
 */
export default function NoOrg() {
  return (
    <AuthShell>
      <Text variant="title2" accessibilityRole="header" className="text-center">
        This app is for club members
      </Text>
      <View className="mt-2 gap-3">
        <Text variant="subheadline" className="text-center text-muted-foreground">
          It shows the playlists your club shares with you.
        </Text>
        <Text variant="subheadline" className="text-center text-muted-foreground">
          Using Scoutable on your own? Your games, playlists and highlights are in the Scoutable desktop app for Mac and
          Windows.
        </Text>
        <Text variant="subheadline" className="text-center text-muted-foreground">
          Joining a club? Ask your coach for an invite code.
        </Text>
      </View>
      <View className="mt-8 gap-1">
        <Button onPress={() => router.push("/onboarding")}>I have an invite code</Button>
        <Button variant="link" size="xs" textClassName="font-medium text-muted-foreground" onPress={() => signOutAndCleanup()}>
          Sign out
        </Button>
      </View>
    </AuthShell>
  );
}
