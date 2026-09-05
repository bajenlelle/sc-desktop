/**
 * My Highlights — the player's own space as a first-class destination.
 * Port of apps/web .../my-highlights/page.tsx.
 *
 * Personal orgs exist so players acquired through club orgs can upgrade to
 * Rookie/Pro and cut their own tapes. Free tier sees a value-first pitch
 * whose only ask is the FREE desktop download — activation before
 * monetization: the free tier (3 imports) is the trial, and the upsell
 * happens inside the desktop app at the quota/watermark gates, where intent
 * is highest. No price or purchase link here, which also keeps iOS clear of
 * App Store 3.1.1. Upgraded players see their own playlists (built in the
 * desktop app, listed here for reference — watching stays via send-to-phone
 * or desktop).
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { listPlaylists } from "@scoutable/shared/lib/playlists-db";
import { isClipItem, type Playlist } from "@scoutable/shared/types/match";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { themeColors } from "@/lib/theme";
import { Button } from "@/components/Button";

const DESKTOP_APP_URL = "https://scoutable.se/#download";
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
  const scheme = useColorScheme();
  const colors = themeColors(scheme);

  function handleDownload() {
    trackEvent("download_clicked", { source: "my_highlights" });
    WebBrowser.openBrowserAsync(DESKTOP_APP_URL).catch(() => {});
  }

  return (
    <ScrollView contentContainerClassName="gap-6 px-4 py-6">
      <View className="items-center gap-2">
        <Text className="text-xs font-semibold uppercase tracking-widest text-primary dark:text-primary-dark">
          My Highlights
        </Text>
        <Text className="text-center font-heading text-3xl text-foreground dark:text-foreground-dark">
          Build your own highlight tape
        </Text>
        <Text className="text-center text-base text-muted-foreground dark:text-muted-foreground-dark">
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
            className="gap-1 rounded-xl border border-border dark:border-border-dark p-4"
          >
            <Ionicons name={b.icon} size={20} color={colors.primary} />
            <Text className="text-sm font-semibold text-foreground dark:text-foreground-dark">
              {b.title}
            </Text>
            <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {b.body}
            </Text>
          </View>
        ))}
      </View>

      <View className="items-center gap-3">
        <Button
          title="Get the desktop app — free"
          onPress={handleDownload}
          className="self-stretch"
        />
        <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
          No card needed.
        </Text>
      </View>
    </ScrollView>
  );
}

function OwnPlaylists() {
  const scheme = useColorScheme();
  const { myOrgs } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  // My Highlights = the player's own reels, which live in the personal
  // space. Coach-org content reaches them via My Playlists → Shared with me.
  const personalOrgId = myOrgs.find((o) => o.isPersonal)?.orgId;

  useEffect(() => {
    if (!personalOrgId) return;
    listPlaylists(supabase, personalOrgId, { includeUnscoped: true })
      .then(setPlaylists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [personalOrgId]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={themeColors(scheme).primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-4 px-4 py-4">
      <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Your own playlists, built in the desktop app. Send them to your phone from there to
        watch and share anywhere.
      </Text>

      {playlists.length === 0 ? (
        <View className="items-center gap-2 py-12">
          <Ionicons
            name="list-outline"
            size={32}
            color={themeColors(scheme).mutedForeground}
          />
          <Text className="text-base font-semibold text-foreground dark:text-foreground-dark">
            No tapes yet
          </Text>
          <Text className="max-w-[280px] text-center text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Import a game in the desktop app and your playlists show up here.
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {playlists.map((pl) => (
            <View
              key={pl.id}
              className="flex-row items-center justify-between rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark px-4 py-3"
            >
              <Text
                numberOfLines={1}
                className="flex-1 text-sm font-medium text-foreground dark:text-foreground-dark"
              >
                {pl.name}
              </Text>
              <Text className="ml-2 text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {pl.items.filter(isClipItem).length} clips
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export default function HighlightsScreen() {
  const { myOrgs, profileLoading } = useAuth();
  const scheme = useColorScheme();

  const personalOrg = myOrgs.find((o) => o.isPersonal) ?? null;
  const upgraded = personalOrg != null && personalOrg.planTier !== "free";

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-row items-center px-4 pb-1 pt-3">
        <Text className="font-heading text-2xl text-foreground dark:text-foreground-dark">
          My Highlights
        </Text>
      </View>
      {profileLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={themeColors(scheme).primary} />
        </View>
      ) : upgraded ? (
        <OwnPlaylists />
      ) : (
        <PitchPage />
      )}
    </SafeAreaView>
  );
}
