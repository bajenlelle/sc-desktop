"use client";

import { useMemo } from "react";
import { Check, ChevronRight, ListVideo, Play } from "lucide-react";
import {
  byLastWatched,
  byNewest,
  computeHero,
  feedCounts,
  filterFeed,
  visibleFeed,
  watchStateOf,
  type FeedPlaylist,
  type WatchFilter,
} from "@scoutable/shared/lib/playlist-feed";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupHeader, GroupedList } from "@/components/ui/group";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProgressRing } from "@/components/ui/progress-ring";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { pressable } from "@/lib/pressable";
import { relativeTime } from "@/lib/format-date";

export interface SourceOption {
  /** "all" | "direct" | `team:<id>` */
  value: string;
  label: string;
}

export interface FeedFilters {
  query: string;
  /** "all" or a sharer's user id. */
  sharer: string;
  /** "all" | "direct" | `team:<id>`. */
  source: string;
  watch: WatchFilter;
}

export const EMPTY_FEED_FILTERS: FeedFilters = { query: "", sharer: "all", source: "all", watch: "all" };

function FeedRow({
  playlist,
  onOpen,
  onResume,
}: {
  playlist: FeedPlaylist;
  onOpen: () => void;
  onResume?: () => void;
}) {
  const state = watchStateOf(playlist);
  const left = Math.max(0, playlist.clipCount - playlist.watchedCount);
  const details = [
    playlist.sharerName ?? "A coach",
    playlist.teamNames && playlist.teamNames.length > 0 ? playlist.teamNames.join(", ") : null,
    `${playlist.clipCount} clip${playlist.clipCount === 1 ? "" : "s"}`,
    relativeTime(playlist.sharedAt),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-center">
      {/* A pressable div, not a <button>: the title must truncate (see pressable.ts). */}
      <div
        {...pressable(onOpen)}
        className="flex min-h-12 min-w-0 flex-1 cursor-default items-center gap-3 px-4 py-2 text-left outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection pointer-coarse:min-h-16"
      >
        <ProgressRing
          value={playlist.clipCount > 0 ? playlist.watchedCount / playlist.clipCount : 0}
          label={`${playlist.watchedCount} of ${playlist.clipCount} watched`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className={state === "new" ? "truncate text-sm font-semibold" : "truncate text-sm"}>{playlist.name}</span>
            {state === "new" && <Badge>New</Badge>}
          </span>
          <span className="truncate text-callout text-muted-foreground nums">{details}</span>
        </span>
        {state === "progress" && (
          <span className="shrink-0 text-callout text-muted-foreground nums">{left} left</span>
        )}
        {!onResume && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
      </div>
      {onResume && (
        <div className="shrink-0 pr-3">
          <Button size="xs" variant="secondary" onClick={onResume}>
            <Play className="fill-current" />
            Resume
          </Button>
        </div>
      )}
    </div>
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
  onResume?: (id: string) => void;
}) {
  if (playlists.length === 0) return null;
  return (
    <section>
      {title && (
        <GroupHeader
          title={
            <>
              {title} <span className="font-normal text-muted-foreground nums">{playlists.length}</span>
            </>
          }
        />
      )}
      <GroupedList>
        {playlists.map((p) => (
          <FeedRow
            key={p.id}
            playlist={p}
            onOpen={() => onOpen(p.id)}
            onResume={onResume && watchStateOf(p) === "progress" ? () => onResume(p.id) : undefined}
          />
        ))}
      </GroupedList>
    </section>
  );
}

/**
 * The recipient's landing view: the one thing to watch next, then what's
 * new, what's part-watched and what's done. The filtering, counts and the
 * call to action live in @scoutable/shared/lib/playlist-feed (shared with
 * desktop and mobile, tested there). Search sits in the page's toolbar, and
 * so do the From/Team filters beside the sidebar; on narrower screens the
 * page hands them in as `filterControls`, shown above the list.
 */
export function PlaylistFeed({
  playlists,
  filters,
  onWatchChange,
  onClearFilters,
  onOpen,
  onResume,
  emptyBody,
  welcome,
  filterControls,
}: {
  playlists: FeedPlaylist[];
  filters: FeedFilters;
  onWatchChange: (watch: WatchFilter) => void;
  onClearFilters: () => void;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  emptyBody?: string;
  welcome?: React.ReactNode;
  filterControls?: React.ReactNode;
}) {
  const inScope = useMemo(
    () => filterFeed(playlists, { query: filters.query, sharer: filters.sharer, source: filters.source }),
    [playlists, filters.query, filters.sharer, filters.source],
  );
  const counts = useMemo(() => feedCounts(inScope), [inScope]);
  const visible = useMemo(() => visibleFeed(inScope, filters.watch), [inScope, filters.watch]);
  // Over ALL playlists: a call to action, not a search result.
  const hero = useMemo(() => computeHero(playlists), [playlists]);
  const searching = filters.query.trim().length > 0;

  if (playlists.length === 0) {
    return (
      <>
        {welcome}
        <EmptyState
          icon={<ListVideo />}
          title="No playlists yet"
          body={emptyBody ?? "When your coach shares clips with you, they show up here."}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {welcome}

      {hero && hero.kind !== "done" && !searching && filters.watch === "all" && (
        <div className="flex flex-col gap-4 rounded-window bg-primary/8 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-subheadline font-semibold text-primary">
              {hero.kind === "continue"
                ? "Pick up where you left off"
                : hero.count === 1
                  ? "New for you"
                  : `${hero.count} new playlists`}
            </p>
            <p className="mt-1 truncate text-title-2 text-foreground">{hero.playlist.name}</p>
            <p className="mt-1 text-sm text-muted-foreground nums">
              {hero.kind === "continue"
                ? `${hero.playlist.watchedCount} of ${hero.playlist.clipCount} watched`
                : [hero.playlist.sharerName, relativeTime(hero.playlist.sharedAt)].filter(Boolean).join(" · ")}
            </p>
            {hero.kind === "continue" && hero.playlist.clipCount > 0 && (
              <ProgressBar
                percent={(hero.playlist.watchedCount / hero.playlist.clipCount) * 100}
                className="mt-2.5 h-1 w-48"
              />
            )}
          </div>
          <Button className="shrink-0" onClick={() => onResume(hero.playlist.id)}>
            <Play className="fill-current" />
            {hero.kind === "continue" ? "Resume" : "Watch"}
          </Button>
        </div>
      )}
      {hero?.kind === "done" && !searching && filters.watch === "all" && (
        <p className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
          <Check className="size-4 text-success" />
          All caught up. You&apos;ve watched everything.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          aria-label="Show"
          className="self-start"
          value={filters.watch}
          onValueChange={onWatchChange}
          options={[
            { value: "all", label: <>All <span className="opacity-60 nums">{counts.all}</span></> },
            { value: "new", label: <>New <span className="opacity-60 nums">{counts.new}</span></> },
            { value: "progress", label: <>In progress <span className="opacity-60 nums">{counts.progress}</span></> },
            { value: "watched", label: <>Watched <span className="opacity-60 nums">{counts.watched}</span></> },
          ]}
        />
        {filterControls && <div className="flex flex-wrap items-center gap-2 lg:hidden">{filterControls}</div>}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body="No playlists match these filters."
          action={
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : filters.watch === "all" ? (
        <>
          <Section
            title="New"
            playlists={visible.filter((p) => watchStateOf(p) === "new").sort(byNewest)}
            onOpen={onOpen}
          />
          <Section
            title="In progress"
            playlists={visible.filter((p) => watchStateOf(p) === "progress").sort(byLastWatched)}
            onOpen={onOpen}
            onResume={onResume}
          />
          <Section
            title="Watched"
            playlists={visible.filter((p) => watchStateOf(p) === "watched").sort(byNewest)}
            onOpen={onOpen}
          />
        </>
      ) : (
        <Section
          playlists={[...visible].sort(filters.watch === "progress" ? byLastWatched : byNewest)}
          onOpen={onOpen}
          onResume={filters.watch === "progress" ? onResume : undefined}
        />
      )}
    </div>
  );
}
