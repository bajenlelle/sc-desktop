import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import {
  activeFeedFilterCount,
  feedCounts,
  filterFeed,
  sharerFilterOptions,
} from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { playableClips, usePlaylists } from "@/lib/playlists-store";
import { useThemeColors } from "@/lib/theme-context";
import { NO_FEED_FILTERS, PlaylistFeed, type FeedFilters } from "@/components/PlaylistFeed";
import { FeedFilterSheet } from "@/components/FeedFilterSheet";
import { FilterButton } from "@/components/ui/FilterButton";
import { Text } from "@/components/ui/Text";
import {
  activeDashboardFilterCount,
  NO_DASHBOARD_FILTERS,
  SharedByMeDashboard,
  type DashboardFilters,
} from "@/components/SharedByMeDashboard";
import { LicenseNotice } from "@/components/LicenseNotice";
import { NotificationPrimer } from "@/components/NotificationPrimer";
import { Screen } from "@/components/shell/Screen";
import { SearchField } from "@/components/ui/SearchField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { RadioOption } from "@/components/ui/RadioGroup";

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
  const [filters, setFilters] = useState<FeedFilters>(NO_FEED_FILTERS);
  const [dashFilters, setDashFilters] = useState<DashboardFilters>(NO_DASHBOARD_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** The dashboard's shared playlists (null while it loads): no filter button without any. */
  const [dashRows, setDashRows] = useState<number | null>(null);
  // A sheet left open for one view never opens over the other.
  useEffect(() => setFiltersOpen(false), [coachTab]);
  const clearFilters = useCallback(() => {
    setFilters(NO_FEED_FILTERS);
    setQuery("");
  }, []);
  const clearDashFilters = useCallback(() => {
    setDashFilters((f) => ({ ...NO_DASHBOARD_FILTERS, sort: f.sort }));
    setQuery("");
  }, []);

  // The feed view-model lives in the store (shared toFeedPlaylists): the
  // tab and app-icon badges derive from the same array, so counts can't drift.

  // Only teams that actually have playlists appear as filter options.
  const sourceOptions = useMemo<RadioOption<string>[]>(() => {
    const opts: RadioOption<string>[] = [{ value: "all", label: "All teams" }];
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

  const sharerOptions = useMemo<RadioOption<string>[]>(() => sharerFilterOptions(feedItems), [feedItems]);
  // Counts in the sheet describe what's reachable under the current team,
  // sharer and search, as the web's chips do (shared playlist-feed, tested).
  const counts = useMemo(
    () => feedCounts(filterFeed(feedItems, { query, sharer: filters.sharer, source: filters.source })),
    [feedItems, query, filters.sharer, filters.source],
  );
  const activeFilters = activeFeedFilterCount(filters);
  /** The active filters in words, for the line under the search field. */
  const activeLabels = useMemo(() => {
    const out: string[] = [];
    if (filters.watch !== "all") out.push({ new: "New", progress: "In progress", watched: "Watched" }[filters.watch]);
    if (filters.source !== "all") out.push(sourceOptions.find((o) => o.value === filters.source)?.label ?? "One team");
    if (filters.sharer !== "all") out.push(`From ${sharerOptions.find((o) => o.value === filters.sharer)?.label ?? "one coach"}`);
    return out;
  }, [filters, sourceOptions, sharerOptions]);

  const showDashboard = isCoachOrAdmin && coachTab === "by-me";
  // Search earns its place from eight playlists (or while a search is on);
  // coaches keep it on the dashboard, whose rows load there.
  const searchable = query.length > 0 || (isCoachOrAdmin && coachTab === "by-me") || feedItems.length >= 8;

  return (
    <Screen
      title={isCoachOrAdmin ? "Shared playlists" : "My playlists"}
      large
      refreshing={refreshing}
      onRefresh={handleRefresh}
      trailing={
        !loading && (showDashboard ? (dashRows ?? 0) > 0 : feedItems.length > 0) ? (
          <FilterButton
            activeCount={showDashboard ? activeDashboardFilterCount(dashFilters) : activeFilters}
            onPress={() => setFiltersOpen(true)}
          />
        ) : undefined
      }
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
      contentClassName="pt-1"
    >
        {!showDashboard && activeFilters > 0 && (
          <Text variant="footnote" className="px-4 pb-1 text-muted-foreground">
            {activeLabels.join(" · ")} ·{" "}
            <Text variant="footnote" accessibilityRole="button" onPress={clearFilters} className="font-semibold text-primary">
              Clear
            </Text>
          </Text>
        )}
        <LicenseNotice />
        {!loading && feedItems.length > 0 && <NotificationPrimer />}

        {loading ? (
          <View className="items-center justify-center py-20">
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : showDashboard ? (
          <SharedByMeDashboard
            query={query}
            refreshNonce={refreshNonce}
            filters={dashFilters}
            onFiltersChange={setDashFilters}
            onClearFilters={clearDashFilters}
            sheetOpen={filtersOpen && showDashboard}
            onCloseSheet={() => setFiltersOpen(false)}
            onRowCountChange={setDashRows}
          />
        ) : (
          <PlaylistFeed
            playlists={feedItems}
            query={query}
            filters={filters}
            onClearFilters={clearFilters}
            onOpen={openPlaylist}
            onResume={resumePlaylist}
            emptyCopy={isCoachOrAdmin ? "Playlists other coaches share with you show up here." : undefined}
          />
        )}
        <FeedFilterSheet
          visible={filtersOpen && !showDashboard}
          onClose={() => setFiltersOpen(false)}
          filters={filters}
          onChange={setFilters}
          counts={counts}
          sourceOptions={sourceOptions}
          sharerOptions={sharerOptions}
        />
    </Screen>
  );
}
