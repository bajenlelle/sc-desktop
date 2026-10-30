import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  activeFeedFilterCount,
  feedCounts,
  filterFeed,
  sharerFilterOptions,
} from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { usePlaylistOpener } from "@/lib/use-playlist-opener";
import { useThemeColors } from "@/lib/theme-context";
import { NO_FEED_FILTERS, PlaylistFeed, type FeedFilters } from "@/components/PlaylistFeed";
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
import { SearchCapsule } from "@/components/shell/SearchCapsule";
import { PopoverMenu, type PopoverGroup } from "@/components/ui/PopoverMenu";

type Option = { value: string; label: string };

/**
 * The playlists destination. Players see what was shared with them (My
 * playlists). Coaches have two views of it, chosen in the sidebar and kept in
 * the `view` param so the path stays /playlists: Shared by me (who watched
 * what they shared) and Shared with me (what other coaches shared with
 * them). Search sits at the top of the content; pull to refresh reloads both.
 */

export default function PlaylistsScreen() {
  const { activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const { loading, allPlaylists, feedItems, directPlaylistIds, teamMap, refresh } = usePlaylists();
  const { openPlaylist, resumePlaylist } = usePlaylistOpener();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const coachTab: "by-me" | "with-me" = view === "with-me" ? "with-me" : "by-me";
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FeedFilters>(NO_FEED_FILTERS);
  const [dashFilters, setDashFilters] = useState<DashboardFilters>(NO_DASHBOARD_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<View>(null);
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
  const sourceOptions = useMemo<Option[]>(() => {
    const opts: Option[] = [{ value: "all", label: "All teams" }];
    if (directPlaylistIds.size > 0) opts.push({ value: "direct", label: "Just for you" });
    for (const [teamId, team] of teamMap) {
      if (allPlaylists.some((p) => (p.teamIds ?? []).includes(teamId))) {
        opts.push({ value: `team:${teamId}`, label: team.name });
      }
    }
    return opts;
  }, [directPlaylistIds, allPlaylists, teamMap]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setRefreshNonce((n) => n + 1);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const sharerOptions = useMemo<Option[]>(() => sharerFilterOptions(feedItems), [feedItems]);
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

  // The feed's filter menu: what to show (with counts), which team, which coach.
  const feedMenu = useMemo<PopoverGroup[]>(() => {
    const setWatch = (watch: FeedFilters["watch"]) => () => setFilters((f) => ({ ...f, watch }));
    const groups: PopoverGroup[] = [
      {
        key: "show",
        items: [
          { key: "all", label: "All", icon: "playlists", count: counts.all, checked: filters.watch === "all", onSelect: setWatch("all") },
          { key: "new", label: "New", icon: "circle", count: counts.new, checked: filters.watch === "new", onSelect: setWatch("new") },
          { key: "progress", label: "In progress", icon: "circleDashed", count: counts.progress, checked: filters.watch === "progress", onSelect: setWatch("progress") },
          { key: "watched", label: "Watched", icon: "checkCircle", count: counts.watched, checked: filters.watch === "watched", onSelect: setWatch("watched") },
        ],
      },
    ];
    if (sourceOptions.length > 1) {
      groups.push({
        key: "team",
        items: sourceOptions.map((o) => ({
          key: o.value,
          label: o.label,
          icon: o.value === "direct" ? "person" : "team",
          checked: filters.source === o.value,
          onSelect: () => setFilters((f) => ({ ...f, source: o.value })),
        })),
      });
    }
    if (sharerOptions.length > 1) {
      groups.push({
        key: "from",
        items: sharerOptions.map((o) => ({
          key: o.value,
          label: o.value === "all" ? "All coaches" : o.label,
          icon: o.value === "all" ? "team" : "person",
          checked: filters.sharer === o.value,
          onSelect: () => setFilters((f) => ({ ...f, sharer: o.value })),
        })),
      });
    }
    return groups;
  }, [counts, filters, sourceOptions, sharerOptions]);

  const showDashboard = isCoachOrAdmin && coachTab === "by-me";
  // Search earns its place from eight playlists (or while a search is on);
  // coaches keep it on the dashboard, whose rows load there.
  const searchable = query.length > 0 || (isCoachOrAdmin && coachTab === "by-me") || feedItems.length >= 8;

  return (
    <Screen
      title={isCoachOrAdmin ? (coachTab === "by-me" ? "Shared by me" : "Shared with me") : "My playlists"}
      menu
      // Both views are cards on the grouped floor (Shared by me and the feed).
      grouped
      refreshing={refreshing}
      onRefresh={handleRefresh}
      trailing={
        !loading && (showDashboard ? (dashRows ?? 0) > 0 : feedItems.length > 0) ? (
          <FilterButton
            anchorRef={filterAnchor}
            activeCount={showDashboard ? activeDashboardFilterCount(dashFilters) : activeFilters}
            onPress={() => setFiltersOpen(true)}
          />
        ) : undefined
      }
      bottom={searchable ? <SearchCapsule value={query} onChangeText={setQuery} /> : undefined}
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
            menuAnchor={filterAnchor}
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
        <PopoverMenu
          visible={filtersOpen && !showDashboard}
          onClose={() => setFiltersOpen(false)}
          anchorRef={filterAnchor}
          accessibilityLabel="Filters"
          groups={feedMenu}
        />
    </Screen>
  );
}
