/**
 * The player's feed, as the web's phone layout (apps/web/src/components/
 * playlist/PlaylistFeed.tsx): the Continue/Start hero, an All / New / In
 * progress / Watched segmented control with From/Team pop-ups, then the
 * sections as grouped rows with progress rings. Renders inside the screen's
 * scroll view (which owns pull-to-refresh and the header search).
 */
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  byLastWatched,
  byNewest,
  computeHero,
  feedCounts,
  filterFeed,
  sharerFilterOptions,
  visibleFeed,
  watchStateOf,
  type FeedPlaylist,
  type WatchFilter,
} from "@scoutable/shared/lib/playlist-feed";
import { relativeTime } from "@/lib/format";
import { useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupHeader, GroupedList } from "@/components/ui/Group";
import { Icon } from "@/components/ui/Icon";
import { PopUpButton, type PopUpOption } from "@/components/ui/PopUpButton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

export type { FeedPlaylist };

function FeedRow({
  playlist,
  onOpen,
  onResume,
}: {
  playlist: FeedPlaylist;
  onOpen: () => void;
  onResume?: () => void;
}) {
  const colors = useThemeColors();
  const largeText = useLargeText();
  const state = watchStateOf(playlist);
  const progress = playlist.clipCount > 0 ? playlist.watchedCount / playlist.clipCount : 0;
  const left = playlist.clipCount - playlist.watchedCount;
  const detail = [
    playlist.sharerName ?? "A coach",
    playlist.teamNames?.length ? playlist.teamNames.join(", ") : null,
    `${playlist.clipCount} clip${playlist.clipCount === 1 ? "" : "s"}`,
    relativeTime(playlist.sharedAt),
  ]
    .filter(Boolean)
    .join(" · ");
  // At the largest text sizes "n left" and Resume go under the text rather
  // than squeezing the title to a few letters.
  if (largeText && state === "progress" && onResume) {
    return (
      <View className="py-1">
        <Tappable
          scaleTo={1}
          accessibilityRole="button"
          accessibilityLabel={`${playlist.name}. ${detail}. ${left} left`}
          onPress={onOpen}
          className={({ pressed }) => cn("flex-row items-center gap-3 px-4 py-2", pressed && "bg-fill-2")}
        >
          <ProgressRing value={progress} />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text numberOfLines={2}>{playlist.name}</Text>
            <Text variant="callout" nums numberOfLines={2} className="text-muted-foreground">
              {detail}
            </Text>
            <Text variant="callout" nums className="text-muted-foreground">
              {left} left
            </Text>
          </View>
        </Tappable>
        <View className="items-start px-4 pb-2">
          <Button
            size="xs"
            variant="secondary"
            onPress={onResume}
            accessibilityLabel={`Resume ${playlist.name}`}
            icon={<Icon name="play" size={12} color={colors.foreground} />}
          >
            Resume
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-center">
      <Tappable
        scaleTo={1}
        accessibilityRole="button"
        accessibilityLabel={`${playlist.name}${state === "new" ? ", new" : ""}. ${detail}`}
        onPress={onOpen}
        className={({ pressed }) => cn("min-h-16 flex-1 flex-row items-center gap-3 py-2 pl-4", pressed && "bg-fill-2", state !== "progress" && "pr-4")}
      >
        <ProgressRing value={progress} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text numberOfLines={largeText ? 2 : 1} className={cn("shrink", state === "new" && "font-semibold")}>
              {playlist.name}
            </Text>
            {state === "new" && <Badge>New</Badge>}
          </View>
          <Text variant="callout" nums numberOfLines={largeText ? 2 : 1} className="text-muted-foreground">
            {detail}
          </Text>
        </View>
        {state === "progress" ? (
          <Text variant="callout" nums className="shrink-0 text-muted-foreground">
            {left} left
          </Text>
        ) : (
          <Icon name="chevronRight" size={14} weight="semibold" color={colors.mutedForeground} style={{ opacity: 0.6 }} />
        )}
      </Tappable>
      {state === "progress" && onResume && (
        <View className="pl-2 pr-3">
          <Button
            size="xs"
            variant="secondary"
            onPress={onResume}
            accessibilityLabel={`Resume ${playlist.name}`}
            icon={<Icon name="play" size={12} color={colors.foreground} />}
          >
            Resume
          </Button>
        </View>
      )}
    </View>
  );
}

function Section({
  title,
  playlists,
  onOpen,
  onResume,
}: {
  title?: string;
  playlists: FeedPlaylist[];
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
}) {
  if (playlists.length === 0) return null;
  return (
    <View>
      {title && (
        <GroupHeader
          title={
            <Text variant="headline">
              {title} <Text variant="headline" nums className="font-normal text-muted-foreground">{playlists.length}</Text>
            </Text>
          }
        />
      )}
      <GroupedList>
        {playlists.map((p) => (
          <FeedRow key={p.id} playlist={p} onOpen={() => onOpen(p.id)} onResume={() => onResume(p.id)} />
        ))}
      </GroupedList>
    </View>
  );
}

export function PlaylistFeed({
  playlists,
  sourceOptions,
  query,
  onClearQuery,
  onOpen,
  onResume,
  emptyCopy,
}: {
  playlists: FeedPlaylist[];
  sourceOptions: PopUpOption<string>[];
  /** From the header's search bar. */
  query: string;
  onClearQuery: () => void;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  /** Overrides the no-playlists body copy (coaches get non-player phrasing). */
  emptyCopy?: string;
}) {
  const colors = useThemeColors();
  const [watch, setWatch] = useState<WatchFilter>("all");
  const [source, setSource] = useState("all");
  const [sharer, setSharer] = useState("all");

  // Filtering, counts and the hero all live in @scoutable/shared/lib/playlist-feed (tested there).
  const sharerOptions = useMemo<PopUpOption<string>[]>(
    () => sharerFilterOptions(playlists).map((o) => ({ value: o.value, label: o.value === "all" ? "From everyone" : `From ${o.label}` })),
    [playlists],
  );
  const inSource = useMemo(() => filterFeed(playlists, { query, sharer, source }), [playlists, source, sharer, query]);
  // The hero is over ALL playlists, not the filtered view: it's a call to action, not a result.
  const hero = useMemo(() => computeHero(playlists), [playlists]);
  const counts = useMemo(() => feedCounts(inSource), [inSource]);
  const visible = useMemo(() => visibleFeed(inSource, watch), [inSource, watch]);
  const searching = query.trim().length > 0;

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
    <View className="gap-6">
      {hero && hero.kind !== "done" && !searching && watch === "all" && (
        <View className="gap-4 rounded-window bg-primary/[0.08] p-5">
          <View className="gap-1">
            <Text variant="subheadline" className="font-semibold text-primary">
              {hero.kind === "continue"
                ? "Pick up where you left off"
                : hero.count === 1
                  ? "New for you"
                  : `${hero.count} new playlists`}
            </Text>
            <Text variant="title2" numberOfLines={1}>
              {hero.playlist.name}
            </Text>
            <Text nums className="text-muted-foreground">
              {hero.kind === "continue"
                ? `${hero.playlist.watchedCount} of ${hero.playlist.clipCount} watched`
                : [hero.playlist.sharerName, relativeTime(hero.playlist.sharedAt)].filter(Boolean).join(" · ")}
            </Text>
            {hero.kind === "continue" && (
              <ProgressBar
                height={4}
                value={hero.playlist.clipCount > 0 ? hero.playlist.watchedCount / hero.playlist.clipCount : 0}
                className="mt-2.5 w-48"
              />
            )}
          </View>
          <Button
            onPress={() => onResume(hero.playlist.id)}
            icon={<Icon name="play" size={16} color={colors.primaryForeground} />}
          >
            {hero.kind === "continue" ? "Resume" : "Watch"}
          </Button>
        </View>
      )}
      {hero?.kind === "done" && !searching && (
        <View className="flex-row items-center gap-2">
          <Icon name="checkCircle" size={16} color={colors.success} />
          <Text className="text-muted-foreground">All caught up. You&apos;ve watched everything.</Text>
        </View>
      )}

      <View className="gap-3">
        <SegmentedControl
          accessibilityLabel="Show"
          value={watch}
          onValueChange={setWatch}
          segments={[
            { value: "all", label: "All", detail: counts.all },
            { value: "new", label: "New", detail: counts.new },
            { value: "progress", label: "In progress", detail: counts.progress },
            { value: "watched", label: "Watched", detail: counts.watched },
          ]}
        />
        {(sharerOptions.length > 0 || sourceOptions.length > 1) && (
          <View className="flex-row flex-wrap gap-2">
            {sharerOptions.length > 0 && (
              <PopUpButton accessibilityLabel="From" value={sharer} onValueChange={setSharer} options={sharerOptions} />
            )}
            {sourceOptions.length > 1 && (
              <PopUpButton accessibilityLabel="Team" value={source} onValueChange={setSource} options={sourceOptions} />
            )}
          </View>
        )}
      </View>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body="No playlists match these filters."
          action={
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setWatch("all");
                setSource("all");
                setSharer("all");
                onClearQuery();
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : watch === "all" ? (
        // Unfiltered, the grouping is the point: it answers "what's new?" at a glance.
        <View className="gap-6">
          <Section title="New" playlists={visible.filter((p) => watchStateOf(p) === "new").sort(byNewest)} onOpen={onOpen} onResume={onResume} />
          <Section
            title="In progress"
            playlists={visible.filter((p) => watchStateOf(p) === "progress").sort(byLastWatched)}
            onOpen={onOpen}
            onResume={onResume}
          />
          <Section title="Watched" playlists={visible.filter((p) => watchStateOf(p) === "watched").sort(byNewest)} onOpen={onOpen} onResume={onResume} />
        </View>
      ) : (
        // With a filter on, a section title would only repeat it.
        <Section playlists={[...visible].sort(watch === "progress" ? byLastWatched : byNewest)} onOpen={onOpen} onResume={onResume} />
      )}
    </View>
  );
}
