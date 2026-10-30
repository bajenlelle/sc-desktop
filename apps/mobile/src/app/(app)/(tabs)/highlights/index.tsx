/**
 * My highlights: the player's own space as a first-class destination
 * (apps/web .../my-highlights/page.tsx, at phone width).
 *
 * One static pitch for everyone, whose only ask is the FREE desktop
 * download: activation before monetization. The free tier (3 imports) is the
 * trial, and the upsell happens inside the desktop app at the quota and
 * watermark gates, where intent is highest.
 *
 * This screen used to list the player's own personal-space playlists, for
 * players it considered "upgraded". That list was inert (rows didn't open,
 * and personal playlists never get an r2Url, so nothing here could play), and
 * it was gated on plan tier, i.e. it unlocked a screen on the strength of a
 * purchase made on the web: the literal wording of App Store 3.1.1, and half
 * of why build 3 was rejected. The other half was a CTA pointing at the
 * marketing page, which sells Rookie and Pro.
 *
 * So: no branch, no user data read, nothing unlocked, and, since a .dmg or
 * .exe is useless on the device holding this screen, no outbound link either.
 * The close is an instruction to act on later, from a computer. Don't turn it
 * back into a button: a link to anywhere on scoutable.se is two taps from the
 * price list, and "no calls to action for purchase outside of the app" is the
 * condition the 3.1.3(f) exemption rests on. (The web's eyebrow and download
 * button are left out for the same reason.)
 */
import { View } from "react-native";
import { Image } from "expo-image";
import { useThemeColors } from "@/lib/theme-context";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Screen } from "@/components/shell/Screen";
import { Text } from "@/components/ui/Text";

// The landing site's /players hero poster: the editor mid vertical-crop. A
// still, not the web's looping video: a loop on a tab isn't worth the data
// and battery here.
const SCREENSHOT_URL = "https://scoutable.se/posters/hero-players.jpg";

const BULLETS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "wand",
    title: "Every clip, cut for you",
    body: "Import your own games and Scoutable auto-generates a named clip for every shot, rebound and steal. No scrubbing.",
  },
  {
    icon: "film",
    title: "Your tape, your story",
    body: "Drag your best plays into a highlight tape. Reorder, trim, add title cards.",
  },
  {
    icon: "share",
    title: "Straight to your phone",
    body: "Scan a QR code and your tape is on your phone, ready for Instagram, TikTok or a recruiting DM.",
  },
];

export default function HighlightsScreen() {
  const colors = useThemeColors();
  return (
    <Screen title="My highlights" menu contentClassName="gap-6 pt-2">
      <View className="gap-1 px-4">
        <Text variant="title2" accessibilityRole="header">
          Build your own highlight tape
        </Text>
        <Text variant="subheadline" className="text-muted-foreground">
          This is your space, separate from your club. Import your own games and turn them into tapes that are yours to
          keep and share.
        </Text>
      </View>

      <View className="mx-4 overflow-hidden rounded-window bg-black">
        <Image
          source={{ uri: SCREENSHOT_URL }}
          contentFit="cover"
          accessibilityLabel="The Scoutable editor cropping a play into a vertical highlight reel"
          style={{ width: "100%", aspectRatio: 1600 / 1034 }}
        />
      </View>

      <View>
        {BULLETS.map((b) => (
          <View key={b.title} className="flex-row items-start gap-3 px-4 py-2.5">
            <View className="mt-0.5">
              <Icon name={b.icon} size={18} color={colors.mutedForeground} />
            </View>
            <View className="min-w-0 flex-1">
              <Text>{b.title}</Text>
              <Text variant="subheadline" className="text-muted-foreground">
                {b.body}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View className="items-center gap-1 px-6 pt-2">
        <View className="mb-1.5">
          <Icon name="computer" size={24} color={colors.mutedForeground} />
        </View>
        <Text variant="headline" className="text-center">
          Get it on your computer
        </Text>
        <Text variant="subheadline" className="max-w-[320px] text-center text-muted-foreground">
          The Scoutable editor runs on Mac and Windows. Open scoutable.se on your computer to download it. It&apos;s free.
        </Text>
      </View>
    </Screen>
  );
}
