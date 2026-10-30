/**
 * The player's feed, calmer than the web's phone layout it started from: an
 * Up next row instead of a tinted hero card, then New, In progress and
 * Watched as plain rows on the page with a ring or a dot in front; once the
 * feed mixes teams, each row names its team above the name. Filters
 * and sort live behind the title bar's filter button (FeedFilterSheet); this
 * component only reads them. Renders inside the screen's scroll view.
 */
import { useMemo } from "react";
import { View } from "react-native";
import {
  computeHero,
  feedHasSeveralSources,
  feedSections,
  feedSourceLabel,
  filterFeed,
  visibleFeed,
  watchStateOf,
  byLastWatched,
  byNewest,
  type FeedPlaylist,
  type WatchFilter,
} from "@scoutable/shared/lib/playlist-feed";
import { relativeTime } from "@/lib/format";
import { useThemeColors } from "@/lib/theme-context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Dot, LEADING_INSET, PlainList, Row, SectionHeader, TextButton } from "@/components/ui/Row";
import { Text } from "@/components/ui/Text";

export type { FeedPlaylist };

export interface FeedFilters {
  watch: WatchFilter;
  source: string;
  sharer: string;
}

export const NO_FEED_FILTERS: FeedFilters = { watch: "all", source: "all", sharer: "all" };

function clipsLabel(n: number): string {
  return `${n} clip${n === 1 ? "" : "s"}`;
}

function FeedRow({
  playlist,
  showSource,
  onOpen,
  onResume,
}: {
  playlist: FeedPlaylist;
  /** The team above the name, once the feed mixes teams (feedHasSeveralSources). */
  showSource: boolean;
  onOpen: () => void;
  onResume: () => void;
}) {
  const colors = useThemeColors();
  const state = watchStateOf(playlist);
  const progress = playlist.clipCount > 0 ? playlist.watchedCount / playlist.clipCount : 0;
  const sharer = playlist.sharerName ?? "A coach";
  const description =
    state === "progress"
      ? `${sharer} · ${playlist.watchedCount} of ${playlist.clipCount} watched`
      : [sharer, clipsLabel(playlist.clipCount), relativeTime(playlist.sharedAt)].filter(Boolean).join(" · ");
  const source = showSource ? feedSourceLabel(playlist) : null;
  return (
    <Row
      overline={source}
      leading={state === "new" ? <Dot color={colors.primary} /> : <ProgressRing value={progress} />}
      label={playlist.name}
      emphasis={state === "new"}
      description={description}
      trailing={
        state === "progress" ? (
          <TextButton label="Resume" onPress={onResume} accessibilityLabel={`Resume ${playlist.name}`} />
        ) : undefined
      }
      chevron={state !== "progress"}
      onPress={onOpen}
      accessibilityLabel={`${playlist.name}${state === "new" ? ", new" : ""}. ${source ? `${source}. ` : ""}${description}`}
    />
  );
}

function Section({
  title,
  playlists,
  showSource,
  onOpen,
  onResume,
}: {
  title?: string;
  playlists: FeedPlaylist[];
  showSource: boolean;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
}) {
  if (playlists.length === 0) return null;
  return (
    <View>
      {title ? <SectionHeader title={title} count={playlists.length} /> : null}
      <PlainList inset={LEADING_INSET}>
        {playlists.map((p) => (
          <FeedRow key={p.id} playlist={p} showSource={showSource} onOpen={() => onOpen(p.id)} onResume={() => onResume(p.id)} />
        ))}
      </PlainList>
    </View>
  );
}

export function PlaylistFeed({
  playlists,
  query,
  filters,
  onClearFilters,
  onOpen,
  onResume,
  emptyCopy,
}: {
  playlists: FeedPlaylist[];
  /** From the search field under the title. */
  query: string;
  filters: FeedFilters;
  /** Resets the filters and the search. */
  onClearFilters: () => void;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  /** Overrides the no-playlists body copy (coaches get non-player phrasing). */
  emptyCopy?: string;
}) {
  const colors = useThemeColors();
  const { watch, source, sharer } = filters;
  // Filtering, counts and the hero all live in @scoutable/shared/lib/playlist-feed (tested there).
  const inSource = useMemo(() => filterFeed(playlists, { query, sharer, source }), [playlists, source, sharer, query]);
  // Up next is over ALL playlists, not the filtered view: it's a call to action, not a result.
  const hero = useMemo(() => computeHero(playlists), [playlists]);
  const visible = useMemo(() => visibleFeed(inSource, watch), [inSource, watch]);
  const searching = query.trim().length > 0;
  const upNext = hero && hero.kind !== "done" && !searching && watch === "all" ? hero : null;
  const sections = useMemo(() => feedSections(visible, upNext?.playlist.id), [visible, upNext]);
  // Over every playlist, not the filtered view, so labels don't come and go with a filter.
  const showSource = useMemo(() => feedHasSeveralSources(playlists), [playlists]);

  if (playlists.length === 0) {
    return (
      <EmptyState
        icon="playlists"
        title="No playlists yet"
        body={emptyCopy ?? "When your coach shares clips with you, they show up here."}
      />
    );
  }

  return (
    <View>
      {upNext && (
        <View>
          <SectionHeader title="Up next" />
          <Row
            leading={
              upNext.kind === "continue" ? (
                <ProgressRing
                  value={upNext.playlist.clipCount > 0 ? upNext.playlist.watchedCount / upNext.playlist.clipCount : 0}
                />
              ) : (
                <Dot color={colors.primary} />
              )
            }
            label={upNext.playlist.name}
            overline={showSource ? feedSourceLabel(upNext.playlist) : null}
            emphasis
            description={
              upNext.kind === "continue"
                ? `${upNext.playlist.watchedCount} of ${upNext.playlist.clipCount} watched · ${upNext.playlist.sharerName ?? "A coach"}`
                : [
                    upNext.count === 1 ? "New" : `${upNext.count} new`,
                    upNext.playlist.sharerName ?? "A coach",
                    relativeTime(upNext.playlist.sharedAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
            trailing={
              <TextButton
                label={upNext.kind === "continue" ? "Resume" : "Watch"}
                onPress={() => onResume(upNext.playlist.id)}
                accessibilityLabel={`${upNext.kind === "continue" ? "Resume" : "Watch"} ${upNext.playlist.name}`}
              />
            }
            onPress={() => onResume(upNext.playlist.id)}
          />
        </View>
      )}
      {hero?.kind === "done" && !searching && (
        <Text variant="subheadline" className="px-4 pt-4 text-muted-foreground">
          All caught up.
        </Text>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body="No playlists match these filters."
          action={<TextButton label="Clear filters" onPress={onClearFilters} />}
        />
      ) : watch === "all" ? (
        // Unfiltered, the grouping is the point: it answers "what's new?" at a glance.
        <View>
          <Section title="New" playlists={sections.new} showSource={showSource} onOpen={onOpen} onResume={onResume} />
          <Section title="In progress" playlists={sections.progress} showSource={showSource} onOpen={onOpen} onResume={onResume} />
          <Section title="Watched" playlists={sections.watched} showSource={showSource} onOpen={onOpen} onResume={onResume} />
        </View>
      ) : (
        // With a filter on, a section title would only repeat it.
        <View className="pt-2">
          <Section playlists={[...visible].sort(watch === "progress" ? byLastWatched : byNewest)} showSource={showSource} onOpen={onOpen} onResume={onResume} />
        </View>
      )}
    </View>
  );
}
