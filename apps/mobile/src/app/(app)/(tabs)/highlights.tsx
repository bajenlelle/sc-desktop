/**
 * My Highlights — the player's own space as a first-class destination.
 * Port of apps/web .../my-highlights/page.tsx.
 *
 * One static pitch for everyone, whose only ask is the FREE desktop download —
 * activation before monetization: the free tier (3 imports) is the trial, and
 * the upsell happens inside the desktop app at the quota/watermark gates, where
 * intent is highest.
 *
 * This screen used to list the player's own personal-space playlists instead,
 * for players it considered "upgraded". That list was inert — rows didn't open,
 * and personal playlists never get an r2Url, so nothing here could ever play
 * (the route to watching your own tape on a phone is send-to-phone from the
 * desktop app, which serves a rendered MP4 at /h/{id}). It was also gated on
 * plan tier, i.e. the app unlocked a screen on the strength of a purchase made
 * on the web — the literal wording of App Store 3.1.1, and half of why build 3
 * was rejected. The other half was this CTA pointing at the marketing page,
 * which sells Rookie and Pro.
 *
 * So: no branch, no user data read, nothing unlocked, and — since a .dmg or
 * .exe is useless on the device holding this screen — no outbound link either.
 * The close is an instruction to act on later, from a computer. Don't turn it
 * back into a button: a link to anywhere on scoutable.se is two taps from the
 * price list, and "no calls to action for purchase outside of the app" is the
 * condition the 3.1.3(f) exemption rests on.
 */
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/lib/theme-context";

// The landing site's /players hero poster — the editor mid vertical-crop.
// (The old screenshot.png 404'd after the landing redesign; it only looked
// alive on devices where expo-image had cached it.) A still, not the video:
// an autoplaying loop on a feed tab isn't worth the data/battery here.
const SCREENSHOT_URL = "https://scoutable.se/posters/hero-players.jpg";

const BULLETS = [
  {
    icon: "color-wand-outline",
    title: "Every clip, cut for you",
    body: "Import your own games and Scoutable auto-generates a named clip for every shot, rebound and steal — no scrubbing.",
  },
  {
    icon: "film-outline",
    title: "Your tape, your story",
    body: "Drag your best plays into a highlight tape. Reorder, trim, add title cards.",
  },
  {
    icon: "share-social-outline",
    title: "Straight to your phone",
    body: "Scan a QR code and your tape is on your phone — ready for Instagram, TikTok or a recruiting DM.",
  },
] as const;

function PitchPage() {
  const colors = useThemeColors();

  return (
    <ScrollView contentContainerClassName="gap-6 px-4 py-6">
      <View className="items-center gap-2">
        <Text className="text-xs font-semibold uppercase tracking-widest text-primary">
          My Highlights
        </Text>
        <Text className="text-center font-heading text-3xl text-foreground">
          Build your own highlight tape
        </Text>
        <Text className="text-center text-base text-muted-foreground">
          This is your space — separate from your club. Import your own games and turn them
          into tapes that are yours to keep and share.
        </Text>
      </View>

      <Image
        source={{ uri: SCREENSHOT_URL }}
        contentFit="cover"
        accessibilityLabel="The Scoutable editor cropping a play into a vertical highlight reel"
        style={{ width: "100%", aspectRatio: 1600 / 1034, borderRadius: 12 }}
      />

      <View className="gap-3">
        {BULLETS.map((b) => (
          <View
            key={b.title}
            className="gap-1 rounded-xl border border-border p-4"
          >
            <Ionicons name={b.icon} size={20} color={colors.primary} />
            <Text className="text-sm font-semibold text-foreground">
              {b.title}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {b.body}
            </Text>
          </View>
        ))}
      </View>

      <View className="items-center gap-2 rounded-xl border border-border bg-card px-4 py-5">
        <Text className="text-center text-base font-semibold text-foreground">
          Get it on your computer
        </Text>
        <Text className="max-w-[300px] text-center text-sm text-muted-foreground">
          The Scoutable editor runs on Mac and Windows. Open scoutable.se on your computer
          to download it — it&apos;s free.
        </Text>
      </View>
    </ScrollView>
  );
}

export default function HighlightsScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="flex-row items-center px-4 pb-1 pt-3">
        <Text className="font-heading text-2xl text-foreground">
          My Highlights
        </Text>
      </View>
      <PitchPage />
    </SafeAreaView>
  );
}
