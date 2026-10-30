/**
 * What was shared with me: the player's feed (and a coach's Shared with me),
 * one card per playlist on the grouped floor, as Shared by me. A card reads
 * top to bottom as where it came from (the team, once the feed mixes
 * teams), what it is (the name, with a dot and semibold while new) and who
 * sent it when; a started playlist adds its progress and Resume. Up next
 * leads as the one card with a filled button, then New, In progress and
 * Watched; Watched shows its three latest until asked for the rest. Filters
 * and sort live behind the title bar's filter button (FeedFilterSheet); this
 * component only reads them. Renders inside the screen's scroll view.
 */
import { useMemo, useState, type ReactNode } from "react";
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
  type FeedHero,
  type FeedPlaylist,
  type WatchFilter,
} from "@scoutable/shared/lib/playlist-feed";
import { relativeTime } from "@/lib/format";
import { useLargeText } from "@/lib/a11y";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Dot, SectionHeader, TextButton } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { WatchBar } from "@/components/ui/WatchBar";

export type { FeedPlaylist };

export interface FeedFilters {
  watch: WatchFilter;
  source: string;
  sharer: string;
}

export const NO_FEED_FILTERS: FeedFilters = { watch: "all", source: "all", sharer: "all" };

/** Watched playlists shown before "Show all": the latest few, the rest on request. */
const WATCHED_PREVIEW = 3;

function clipsLabel(n: number): string {
  return `${n} clip${n === 1 ? "" : "s"}`;
}

/** "Karin Ahl · 12 clips · 2h ago": who sent it, how much, when. */
function metaLine(p: FeedPlaylist): string {
  return [p.sharerName ?? "A coach", clipsLabel(p.clipCount), relativeTime(p.sharedAt)].filter(Boolean).join(" · ");
}

/** The playlist's own progress: a bar and "2 of 6 watched". Decorative bar; the words carry it. */
function Progress({ playlist, trailing }: { playlist: FeedPlaylist; trailing?: ReactNode }) {
  const large = useLargeText();
  const words = `${playlist.watchedCount} of ${playlist.clipCount} watched`;
  const bar = <WatchBar done={playlist.watchedCount} started={playlist.watchedCount} total={playlist.clipCount} className={large ? undefined : "flex-1"} />;
  if (large) {
    return (
      <View className="mt-3 gap-1.5">
        {bar}
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="footnote" nums className="text-muted-foreground">
            {words}
          </Text>
          {trailing}
        </View>
      </View>
    );
  }
  return (
    <View className="mt-3 flex-row items-center gap-3">
      {bar}
      <Text variant="footnote" nums className="text-muted-foreground">
        {words}
      </Text>
      {trailing}
    </View>
  );
}

function FeedCard({
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
  const large = useLargeText();
  const state = watchStateOf(playlist);
  const source = showSource ? feedSourceLabel(playlist) : null;
  const meta = metaLine(playlist);
  const isNew = state === "new";
  return (
    <Card>
      <Tappable
        scaleTo={1}
        accessibilityRole="button"
        accessibilityLabel={[
          `${playlist.name}${isNew ? ", new" : ""}`,
          source,
          meta,
          state === "progress" ? `${playlist.watchedCount} of ${playlist.clipCount} watched` : state === "watched" ? "Watched" : null,
        ]
          .filter(Boolean)
          .join(". ")}
        onPress={onOpen}
        className={({ pressed }) => cn("px-4 py-3", pressed && "bg-fill-1")}
      >
        <View className="flex-row items-start gap-3">
          <View className="min-w-0 flex-1">
            {source ? (
              <Text variant="footnote" numberOfLines={large ? 2 : 1} className="text-muted-foreground">
                {source}
              </Text>
            ) : null}
            <View className="flex-row items-center gap-2">
              {isNew ? <Dot color={colors.primary} /> : null}
              <Text variant={isNew ? "headline" : "body"} numberOfLines={large ? 3 : 2} className="shrink">
                {playlist.name}
              </Text>
            </View>
            <Text variant="subheadline" nums numberOfLines={large ? undefined : 1} className="text-muted-foreground">
              {meta}
            </Text>
          </View>
          {state !== "progress" ? (
            <Icon name="chevronRight" size={16} strokeWidth={2} color={colors.mutedForeground} style={{ opacity: 0.5, marginTop: source ? 20 : 3 }} />
          ) : null}
        </View>
        {state === "progress" ? (
          <Progress
            playlist={playlist}
            trailing={<TextButton label="Resume" onPress={onResume} accessibilityLabel={`Resume ${playlist.name}`} />}
          />
        ) : null}
      </Tappable>
    </Card>
  );
}

/** The one thing to do next, as streaming apps lead with Continue watching: a card with a filled button. */
function UpNextCard({
  hero,
  showSource,
  onResume,
}: {
  hero: Exclude<FeedHero, { kind: "done" } | null>;
  showSource: boolean;
  onResume: (id: string) => void;
}) {
  const colors = useThemeColors();
  const large = useLargeText();
  const p = hero.playlist;
  const source = showSource ? feedSourceLabel(p) : null;
  const action = hero.kind === "continue" ? "Resume" : "Watch";
  const meta = hero.kind === "continue" ? metaLine(p) : [hero.count === 1 ? "New" : `${hero.count} new`, metaLine(p)].join(" · ");
  return (
    <Card>
      <Tappable
        scaleTo={1}
        accessibilityRole="button"
        accessibilityLabel={[`${action} ${p.name}`, source, meta].filter(Boolean).join(". ")}
        onPress={() => onResume(p.id)}
        className={({ pressed }) => cn("px-4 pb-4 pt-3", pressed && "bg-fill-1")}
      >
        {source ? (
          <Text variant="footnote" numberOfLines={large ? 2 : 1} className="text-muted-foreground">
            {source}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-2">
          {hero.kind === "start" ? <Dot color={colors.primary} /> : null}
          <Text variant="title3" numberOfLines={large ? 4 : 2} className="shrink">
            {p.name}
          </Text>
        </View>
        <Text variant="subheadline" nums className="mt-0.5 text-muted-foreground">
          {meta}
        </Text>
        {hero.kind === "continue" ? <Progress playlist={p} /> : null}
        <Button
          className="mt-4"
          icon={<Icon name="play" size={16} color={colors.primaryForeground} />}
          onPress={() => onResume(p.id)}
          accessibilityLabel={`${action} ${p.name}`}
        >
          {action}
        </Button>
      </Tappable>
    </Card>
  );
}

function Section({
  title,
  playlists,
  showSource,
  onOpen,
  onResume,
  footer,
}: {
  title?: string;
  playlists: FeedPlaylist[];
  showSource: boolean;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  footer?: ReactNode;
}) {
  if (playlists.length === 0) return null;
  return (
    <View>
      {title ? <SectionHeader title={title} count={playlists.length} /> : null}
      <View className="gap-2.5">
        {playlists.map((p) => (
          <FeedCard key={p.id} playlist={p} showSource={showSource} onOpen={() => onOpen(p.id)} onResume={() => onResume(p.id)} />
        ))}
      </View>
      {footer}
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
  const { watch, source, sharer } = filters;
  const [allWatched, setAllWatched] = useState(false);
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

  // Watched is the long tail: its latest few, the rest on request (a search shows every match).
  const watchedShown = allWatched || searching ? sections.watched : sections.watched.slice(0, WATCHED_PREVIEW);
  const watchedHidden = sections.watched.length - watchedShown.length;

  return (
    <View>
      {upNext && (
        <View>
          <SectionHeader title="Up next" />
          <UpNextCard hero={upNext} showSource={showSource} onResume={onResume} />
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
          {sections.watched.length > 0 && (
            <View>
              <SectionHeader title="Watched" count={sections.watched.length} />
              <View className="gap-2.5">
                {watchedShown.map((p) => (
                  <FeedCard key={p.id} playlist={p} showSource={showSource} onOpen={() => onOpen(p.id)} onResume={() => onResume(p.id)} />
                ))}
              </View>
              {watchedHidden > 0 || (allWatched && sections.watched.length > WATCHED_PREVIEW && !searching) ? (
                <View className="items-center pt-2">
                  <TextButton
                    label={watchedHidden > 0 ? `Show all ${sections.watched.length} watched` : "Show fewer"}
                    onPress={() => setAllWatched(watchedHidden > 0)}
                  />
                </View>
              ) : null}
            </View>
          )}
        </View>
      ) : (
        // With a filter on, a section title would only repeat it.
        <View className="pt-3">
          <Section playlists={[...visible].sort(watch === "progress" ? byLastWatched : byNewest)} showSource={showSource} onOpen={onOpen} onResume={onResume} />
        </View>
      )}
    </View>
  );
}
