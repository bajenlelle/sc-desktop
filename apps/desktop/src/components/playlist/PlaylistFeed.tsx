import { useMemo, useState } from "react";
import { Check, ChevronDown, ListVideo, Play, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlaylistCard, type PlaylistCardData } from "@/components/playlist/PlaylistCard";
import { cn } from "@/lib/utils";
import {
  byLastWatched,
  byNewest,
  computeHero,
  feedCounts,
  filterFeed,
  relativeTimeShort,
  sharerFilterOptions,
  visibleFeed,
  watchStateOf,
  type WatchFilter,
} from "@scoutable/shared/lib/playlist-feed";

/** Search earns its place once the list stops fitting on one screen. */
const SEARCH_THRESHOLD = 10;

export interface SourceOption {
  /** "all" | "direct" | `team:<id>` */
  value: string;
  label: string;
}

function Section({
  title,
  playlists,
  onOpen,
  onResume,
}: {
  title?: string;
  playlists: PlaylistCardData[];
  onOpen: (id: string) => void;
  onResume?: (id: string) => void;
}) {
  if (playlists.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
          <span className="ml-1.5 font-normal opacity-60">{playlists.length}</span>
        </h2>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {playlists.map((p) => (
          <PlaylistCard
            key={p.id}
            playlist={p}
            onOpen={() => onOpen(p.id)}
            onResume={onResume ? () => onResume(p.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The player's landing view: what's new, what's part-watched, what's done.
 *
 * Mirrors the web feed so the two clients behave identically. The source
 * dropdown duplicates what the sidebar already groups by, but keeping it means
 * the filter bar reads the same in both apps and stays useful once a player
 * has a season's worth of playlists.
 */
export function PlaylistFeed({
  playlists,
  sourceOptions,
  onOpen,
  onResume,
  emptyCopy,
}: {
  playlists: PlaylistCardData[];
  sourceOptions: SourceOption[];
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  /** Overrides the no-playlists body copy (coaches get non-player phrasing). */
  emptyCopy?: string;
}) {
  const [watch, setWatch] = useState<WatchFilter>("all");
  const [source, setSource] = useState("all");
  const [sharer, setSharer] = useState("all");
  const [query, setQuery] = useState("");

  // Filtering, counts, and the hero CTA all live in
  // @scoutable/shared/lib/playlist-feed (tested there).
  const sharerOptions = useMemo(() => sharerFilterOptions(playlists), [playlists]);

  const inSource = useMemo(
    () => filterFeed(playlists, { query, sharer, source }),
    [playlists, source, sharer, query],
  );

  const counts = useMemo(() => feedCounts(inSource), [inSource]);

  const visible = useMemo(() => visibleFeed(inSource, watch), [inSource, watch]);

  // Hero is computed over ALL playlists (not the filtered view) — it's a call
  // to action, not a search result.
  const hero = useMemo(() => computeHero(playlists), [playlists]);

  const activeSourceLabel =
    sourceOptions.find((o) => o.value === source)?.label ?? "All playlists";

  const chips: { key: WatchFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "progress", label: "In progress" },
    { key: "watched", label: "Watched" },
  ];

  const hasAnything = playlists.length > 0;

  return (
    <div className="flex flex-col">
      {hasAnything && (
        // Sticky so the filters stay reachable while scrolling a long list.
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-6">
            <h1 className="text-lg font-semibold text-foreground">My Playlists</h1>
            {/* From = who shared it; To = which team it reached. Grouped so
                justify-between can't strand one dropdown mid-header. */}
            <div className="flex shrink-0 items-center gap-2">
            {sharerOptions.length > 0 && (
              <label className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">From</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground"
                  >
                    <span className="max-w-[8rem] truncate">
                      {sharer === "all"
                        ? "Everyone"
                        : sharerOptions.find((o) => o.value === sharer)?.label ?? "Everyone"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {sharerOptions.map((o) => (
                    <DropdownMenuItem
                      key={o.value}
                      onClick={() => setSharer(o.value)}
                      className={cn("text-sm", o.value === sharer && "font-semibold text-primary")}
                    >
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              </label>
            )}
            {sourceOptions.length > 1 && (
              <label className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Team</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground"
                  >
                    <span className="max-w-[9rem] truncate">{activeSourceLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {sourceOptions.map((o) => (
                    <DropdownMenuItem
                      key={o.value}
                      onClick={() => setSource(o.value)}
                      className={cn("text-sm", o.value === source && "font-semibold text-primary")}
                    >
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              </label>
            )}
            </div>
          </div>

          {playlists.length > SEARCH_THRESHOLD && (
            <div className="relative px-4 pb-2 sm:px-6">
              <Search className="pointer-events-none absolute left-7 top-1/2 mt-[-4px] h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-9" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search playlists…"
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-5 top-1/2 mt-[-4px] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground sm:right-7"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Scrolls sideways rather than wrapping — keeps the bar one row on
              a narrow screen. */}
          <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips.map((c) => {
              const n = counts[c.key];
              const active = watch === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setWatch(c.key)}
                  className={cn(
                    "flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {c.label}
                  <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!hasAnything ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <ListVideo className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">No playlists yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {emptyCopy ?? "When your coach shares clips with you, they'll show up here."}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">Nothing here right now.</p>
          <button
            type="button"
            onClick={() => { setWatch("all"); setSource("all"); setSharer("all"); setQuery(""); }}
            className="min-h-[36px] text-sm font-medium text-primary"
          >
            Clear filters
          </button>
        </div>
      ) : watch === "all" ? (
        // Unfiltered, the grouping is the point — it answers "what's new?"
        // at a glance without any interaction.
        <div className="flex flex-col gap-8 px-4 py-5 sm:px-6">
          {/* Hero CTA — hidden while searching (the user is already navigating). */}
          {hero && !query.trim() && hero.kind !== "done" && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {hero.kind === "continue"
                    ? "Pick up where you left off"
                    : hero.count === 1
                      ? "You have a new playlist"
                      : `You have ${hero.count} new playlists`}
                </p>
                <p className="mt-1 truncate text-base font-semibold text-foreground">
                  {hero.playlist.name}
                  {hero.playlist.teamNames && hero.playlist.teamNames.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {" "}· {hero.playlist.teamNames.join(", ")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {hero.kind === "continue"
                    ? `${hero.playlist.watchedCount} of ${hero.playlist.clipCount} watched`
                    : [hero.playlist.sharerName, relativeTimeShort(hero.playlist.sharedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onResume(hero.playlist.id)}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Play className="h-4 w-4" />
                {hero.kind === "continue" ? "Continue watching" : "Start watching"}
              </button>
            </div>
          )}
          {hero?.kind === "done" && !query.trim() && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              All caught up — you&apos;ve watched everything.
            </p>
          )}
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
        </div>
      ) : (
        // With a chip active the section header would just repeat it, so the
        // list goes flat.
        <div className="px-4 py-5 sm:px-6">
          <Section
            playlists={[...visible].sort(watch === "progress" ? byLastWatched : byNewest)}
            onOpen={onOpen}
            onResume={watch === "progress" ? onResume : undefined}
          />
        </div>
      )}
    </div>
  );
}
