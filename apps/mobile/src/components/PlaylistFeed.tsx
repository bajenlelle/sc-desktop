/**
 * What was shared with me (the player's My playlists, a coach's Shared with
 * me), as Claude's Cowork list: grouped by when it was shared (This week,
 * Last week, then by month), newest first, so this week's scouting is what
 * a player sees first. Each row: a status glyph in front (an empty ring for
 * new, a part ring for started, a check for watched), the team above the
 * name once the feed mixes teams, the name, one quiet line (who, how much,
 * when), and a primary dot at the end while new. Rows sit on the page with
 * no cards or dividers. A started playlist resumes where it stopped; the
 * screen's floating pill does the same for the one to watch next. Filters
 * and sort live in the title bar's pop-up menu; this component only reads
 * them. Renders inside the screen's scroll view.
 */
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import {
  feedHasSeveralSources,
  feedSourceLabel,
  filterFeed,
  visibleFeed,
  watchStateOf,
  byNewest,
  type FeedPlaylist,
  type WatchFilter,
  type WatchState,
} from "@scoutable/shared/lib/playlist-feed";
import { shareTimeSections } from "@scoutable/shared/lib/share-time";
import { relativeTime } from "@/lib/format";
import { useLargeText } from "@/lib/a11y";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Dot, TextButton } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

export type { FeedPlaylist };

export interface FeedFilters {
  watch: WatchFilter;
  source: string;
  sharer: string;
}

export const NO_FEED_FILTERS: FeedFilters = { watch: "all", source: "all", sharer: "all" };

const GLYPH = 18;

function clipsLabel(n: number): string {
  return `${n} clip${n === 1 ? "" : "s"}`;
}

/** "New · Karin Ahl · 12 clips · 2d ago", "Karin Ahl · 2 of 6 watched", "Mats Ek · 9 clips · 21 Oct". */
function metaLine(p: FeedPlaylist, state: WatchState): string {
  const who = p.sharerName ?? "A coach";
  if (state === "progress") return `${who} · ${p.watchedCount} of ${p.clipCount} watched`;
  return [state === "new" ? "New" : null, who, clipsLabel(p.clipCount), relativeTime(p.sharedAt)].filter(Boolean).join(" · ");
}

/** The row's state at a glance: an empty ring, a ring filling up, a check. Decorative; the words say it too. */
function StatusGlyph({ state, progress }: { state: WatchState; progress: number }) {
  const colors = useThemeColors();
  if (state === "watched") return <Icon name="checkCircle" size={GLYPH} color={colors.mutedForeground} />;
  const r = (GLYPH - 2) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={GLYPH} height={GLYPH} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={GLYPH / 2} cy={GLYPH / 2} r={r} stroke={state === "new" ? colors.mutedForeground : colors.fill3} strokeWidth={1.75} fill="none" />
      {state === "progress" ? (
        <Circle
          cx={GLYPH / 2}
          cy={GLYPH / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.06, progress) * c} ${c}`}
        />
      ) : null}
    </Svg>
  );
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
  const large = useLargeText();
  const state = watchStateOf(playlist);
  const source = showSource ? feedSourceLabel(playlist) : null;
  const meta = metaLine(playlist, state);
  const progress = playlist.clipCount > 0 ? playlist.watchedCount / playlist.clipCount : 0;
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityLabel={[`${playlist.name}${state === "watched" ? ", watched" : ""}`, source, meta].filter(Boolean).join(". ")}
      accessibilityHint={state === "progress" ? "Resumes where you stopped" : undefined}
      // A started playlist goes on from where the player stopped.
      onPress={state === "progress" ? onResume : onOpen}
      className={({ pressed }) => cn("flex-row items-start gap-3.5 px-4 py-3", pressed && "bg-fill-1")}
    >
      <View style={{ marginTop: source ? 20 : 2 }}>
        <StatusGlyph state={state} progress={progress} />
      </View>
      <View className="min-w-0 flex-1">
        {source ? (
          <Text variant="footnote" numberOfLines={large ? 2 : 1} className="text-muted-foreground">
            {source}
          </Text>
        ) : null}
        <Text numberOfLines={large ? 3 : 2}>{playlist.name}</Text>
        <Text variant="subheadline" nums numberOfLines={large ? undefined : 1} className="mt-0.5 text-muted-foreground">
          {meta}
        </Text>
      </View>
      {state === "new" ? (
        <View style={{ marginTop: source ? 25 : 7 }}>
          <Dot color={colors.primary} />
        </View>
      ) : null}
    </Tappable>
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
  /** From the search capsule. */
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
  // Filtering and counts live in @scoutable/shared/lib/playlist-feed, the weeks in share-time (both tested).
  const inSource = useMemo(() => filterFeed(playlists, { query, sharer, source }), [playlists, source, sharer, query]);
  const visible = useMemo(() => [...visibleFeed(inSource, watch)].sort(byNewest), [inSource, watch]);
  const sections = useMemo(() => shareTimeSections(visible, (p) => p.sharedAt), [visible]);
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

  if (visible.length === 0) {
    return (
      <EmptyState
        title="Nothing matches"
        body="No playlists match these filters."
        action={<TextButton label="Clear filters" onPress={onClearFilters} />}
      />
    );
  }

  return (
    <View>
      {sections.map((s, i) => (
        <View key={s.key}>
          <Text variant="subheadline" accessibilityRole="header" className={cn("px-4 pb-1 text-muted-foreground", i === 0 ? "pt-2" : "pt-6")}>
            {s.title}
          </Text>
          {s.items.map((p) => (
            <FeedRow key={p.id} playlist={p} showSource={showSource} onOpen={() => onOpen(p.id)} onResume={() => onResume(p.id)} />
          ))}
        </View>
      ))}
    </View>
  );
}
