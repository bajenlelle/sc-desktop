import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { playableClips, usePlaylists } from "@/lib/playlists-store";
import { themeColors } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";
import { PlaylistFeed } from "@/components/PlaylistFeed";
import { ReportProblemSheet } from "@/components/ReportProblemSheet";
import { SharedByMeDashboard } from "@/components/SharedByMeDashboard";
import { LicenseNotice } from "@/components/LicenseNotice";
import { NotificationPrimer } from "@/components/NotificationPrimer";
import type { SelectOption } from "@/components/Select";

export default function PlaylistsScreen() {
  const { profile, activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const {
    loading,
    allPlaylists,
    feedItems,
    directPlaylistIds,
    teamMap,
    clipViews,
    refresh,
  } = usePlaylists();
  const scheme = useColorScheme();
  const [refreshing, setRefreshing] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");

  // The feed view-model lives in the store (shared toFeedPlaylists) — the
  // tab/app-icon badges derive from the same array, so counts can't drift.

  // Only teams that actually have playlists appear as filter options.
  const sourceOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: "all", label: "All playlists" }];
    if (directPlaylistIds.size > 0) opts.push({ value: "direct", label: "Shared with me" });
    for (const [teamId, team] of teamMap) {
      if (allPlaylists.some((p) => (p.teamIds ?? []).includes(teamId))) {
        opts.push({ value: `team:${teamId}`, label: team.name });
      }
    }
    return opts;
  }, [directPlaylistIds, allPlaylists, teamMap]);

  const openPlaylist = useCallback((id: string) => {
    trackEvent("playlist_opened", { playlist_id: id, resumed: false });
    router.push(`/playlists/${id}`);
  }, []);

  /** Opens a playlist starting from the first clip the player hasn't watched. */
  const resumePlaylist = useCallback(
    (id: string) => {
      trackEvent("playlist_opened", { playlist_id: id, resumed: true });
      const pl = allPlaylists.find((p) => p.id === id);
      const firstUnwatched = pl
        ? playableClips(pl).find((c) => !clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId)))
        : undefined;
      if (firstUnwatched) {
        router.push(
          `/playlists/${id}?resume=${encodeURIComponent(
            `${firstUnwatched.matchId}:${firstUnwatched.eventId}`
          )}`
        );
      } else {
        router.push(`/playlists/${id}`);
      }
    },
    [allPlaylists, clipViews]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
        <Text className="font-heading text-2xl text-foreground dark:text-foreground-dark">
          {isCoachOrAdmin ? "Shared Playlists" : "My Playlists"}
        </Text>
        <View className="flex-row items-center gap-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send feedback"
            onPress={() => setFeedbackOpen(true)}
            className="min-h-[44px] items-center justify-center rounded-full border border-border dark:border-border-dark px-3"
          >
            <Text className="text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
              Feedback
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile"
            onPress={() => router.navigate("/profile")}
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={32} />
          </Pressable>
        </View>
      </View>

      {/* Coaches get two views: their outbound dashboard and the normal
          inbound feed — same split as web/desktop. */}
      {isCoachOrAdmin && (
        <View className="flex-row gap-1 border-b border-border dark:border-border-dark px-4 pb-2">
          {(
            [
              ["by-me", "Shared by me"],
              ["with-me", "Shared with me"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => setCoachTab(key)}
              className={`min-h-[36px] justify-center rounded-md px-3 ${
                coachTab === key ? "bg-primary/10 dark:bg-primary-dark/10" : ""
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  coachTab === key
                    ? "text-primary dark:text-primary-dark"
                    : "text-muted-foreground dark:text-muted-foreground-dark"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <LicenseNotice className="mx-4 mb-2" />

      {!loading && feedItems.length > 0 && <NotificationPrimer />}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={themeColors(scheme).primary} />
        </View>
      ) : isCoachOrAdmin && coachTab === "by-me" ? (
        <SharedByMeDashboard />
      ) : (
        <PlaylistFeed
          playlists={feedItems}
          sourceOptions={sourceOptions}
          onOpen={openPlaylist}
          onResume={resumePlaylist}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          emptyCopy={
            isCoachOrAdmin
              ? "Playlists other coaches share with you show up here."
              : undefined
          }
        />
      )}
      <ReportProblemSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </SafeAreaView>
  );
}
