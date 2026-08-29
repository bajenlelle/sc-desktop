import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { useAuth } from "@/lib/auth-context";
import { playableClips, usePlaylists } from "@/lib/playlists-store";
import { themeColors } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";
import { PlaylistFeed } from "@/components/PlaylistFeed";
import { ReportProblemSheet } from "@/components/ReportProblemSheet";
import { SharedByMeDashboard } from "@/components/SharedByMeDashboard";
import type { PlaylistCardData } from "@/components/PlaylistCard";
import type { SelectOption } from "@/components/Select";

export default function PlaylistsScreen() {
  const { profile, user, activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const {
    loading,
    allPlaylists,
    directPlaylistIds,
    teamMap,
    memberMap,
    clipViews,
    lastWatched,
    refresh,
  } = usePlaylists();
  const scheme = useColorScheme();
  const [refreshing, setRefreshing] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");

  // Cards for the landing feed, with per-playlist progress folded in
  // (port of web's feedItems memo). Own playlists are excluded: "Shared
  // with me" means what OTHERS sent — a coach's outbound playlists live on
  // the dashboard tab, otherwise they'd see themselves as the sharer.
  const feedItems = useMemo<PlaylistCardData[]>(() => {
    return allPlaylists
      .filter((pl) => !user?.id || pl.createdBy !== user.id)
      .map((pl) => {
      const clips = playableClips(pl);
      const watchedCount = clips.filter((c) =>
        clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId))
      ).length;
      const sharer = pl.sharedBy ? memberMap.get(pl.sharedBy) : undefined;
      return {
        id: pl.id,
        name: pl.name,
        clipCount: clips.length,
        watchedCount,
        sharedAt: pl.sharedAt,
        lastWatchedAt: lastWatched.get(pl.id),
        sharerId: pl.sharedBy,
        // Email fallback: a sharer without full_name otherwise collapses to
        // the anonymous "Your coach".
        sharerName: sharer?.fullName ?? sharer?.email ?? undefined,
        sharerAvatarUrl: sharer?.avatarUrl ?? undefined,
        isDirect: directPlaylistIds.has(pl.id),
        teamIds: pl.teamIds ?? [],
        teamNames: (pl.teamIds ?? [])
          .map((id) => teamMap.get(id)?.name)
          .filter((n): n is string => !!n),
      };
    });
  }, [allPlaylists, directPlaylistIds, clipViews, lastWatched, memberMap, teamMap, user?.id]);

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
    router.push(`/playlists/${id}`);
  }, []);

  /** Opens a playlist starting from the first clip the player hasn't watched. */
  const resumePlaylist = useCallback(
    (id: string) => {
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
            onPress={() => router.push("/profile")}
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
