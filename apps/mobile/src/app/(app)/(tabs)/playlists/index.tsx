import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { playableClips, usePlaylists } from "@/lib/playlists-store";
import { useThemeColors } from "@/lib/theme-context";
import { PlaylistFeed } from "@/components/PlaylistFeed";
import { SharedByMeDashboard } from "@/components/SharedByMeDashboard";
import { LicenseNotice } from "@/components/LicenseNotice";
import { NotificationPrimer } from "@/components/NotificationPrimer";
import { Screen } from "@/components/shell/Screen";
import { SearchField } from "@/components/ui/SearchField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { PopUpOption } from "@/components/ui/PopUpButton";

/**
 * The Playlists tab, as the web's phone layout: one scroll view under the
 * large title (which hands over to the bar's small title as it scrolls), for
 * coaches a Shared by me / Shared with me switch under it, then search, the
 * same field on iOS and Android. Pull to refresh reloads both views.
 */

export default function PlaylistsScreen() {
  const { activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const { loading, allPlaylists, feedItems, directPlaylistIds, teamMap, clipViews, refresh } = usePlaylists();
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");
  const [query, setQuery] = useState("");
  /** Clear filters empties the search too. */
  const clearQuery = useCallback(() => setQuery(""), []);

  // The feed view-model lives in the store (shared toFeedPlaylists): the
  // tab and app-icon badges derive from the same array, so counts can't drift.

  // Only teams that actually have playlists appear as filter options.
  const sourceOptions = useMemo<PopUpOption<string>[]>(() => {
    const opts: PopUpOption<string>[] = [{ value: "all", label: "All teams" }];
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
        router.push(`/playlists/${id}?resume=${encodeURIComponent(`${firstUnwatched.matchId}:${firstUnwatched.eventId}`)}`);
      } else {
        router.push(`/playlists/${id}`);
      }
    },
    [allPlaylists, clipViews],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setRefreshNonce((n) => n + 1);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const showDashboard = isCoachOrAdmin && coachTab === "by-me";
  // Only a player with nothing to search loses the field.
  const searchable = loading || isCoachOrAdmin || feedItems.length > 0;

  return (
    <Screen
      title={isCoachOrAdmin ? "Shared playlists" : "My playlists"}
      large
      refreshing={refreshing}
      onRefresh={handleRefresh}
      principal={
        // Coaches get two views: who watched what they shared, and the
        // playlists others shared with them (same split as web).
        isCoachOrAdmin ? (
          <SegmentedControl
            fullWidth
            size="md"
            accessibilityLabel="Show"
            value={coachTab}
            onValueChange={setCoachTab}
            segments={[
              { value: "by-me", label: "Shared by me" },
              { value: "with-me", label: "Shared with me" },
            ]}
          />
        ) : undefined
      }
      search={
        searchable ? (
          <SearchField value={query} onChangeText={setQuery} placeholder="Search" accessibilityLabel="Search playlists" />
        ) : undefined
      }
      contentClassName="gap-5 px-4 pt-2"
    >
        <LicenseNotice />
        {!loading && feedItems.length > 0 && <NotificationPrimer />}

        {loading ? (
          <View className="items-center justify-center py-20">
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : showDashboard ? (
          <SharedByMeDashboard query={query} onClearQuery={clearQuery} refreshNonce={refreshNonce} />
        ) : (
          <PlaylistFeed
            playlists={feedItems}
            sourceOptions={sourceOptions}
            query={query}
            onClearQuery={clearQuery}
            onOpen={openPlaylist}
            onResume={resumePlaylist}
            emptyCopy={isCoachOrAdmin ? "Playlists other coaches share with you show up here." : undefined}
          />
        )}
    </Screen>
  );
}
