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
import type { PlaylistCardData } from "@/components/PlaylistCard";
import type { SelectOption } from "@/components/Select";

export default function PlaylistsScreen() {
  const { profile } = useAuth();
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

  // Cards for the landing feed, with per-playlist progress folded in
  // (port of web's feedItems memo).
  const feedItems = useMemo<PlaylistCardData[]>(() => {
    return allPlaylists.map((pl) => {
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
  }, [allPlaylists, directPlaylistIds, clipViews, lastWatched, memberMap, teamMap]);

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
          My Playlists
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile"
          onPress={() => router.push("/profile")}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={32} />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={themeColors(scheme).primary} />
        </View>
      ) : (
        <PlaylistFeed
          playlists={feedItems}
          sourceOptions={sourceOptions}
          onOpen={openPlaylist}
          onResume={resumePlaylist}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}
    </SafeAreaView>
  );
}
