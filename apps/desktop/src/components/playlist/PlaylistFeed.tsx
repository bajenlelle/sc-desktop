import { useMemo, useState } from "react";
import { ChevronDown, ListVideo } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlaylistCard, type PlaylistCardData } from "@/components/playlist/PlaylistCard";
import { cn } from "@/lib/utils";

type WatchFilter = "all" | "new" | "progress" | "watched";

export interface SourceOption {
  /** "all" | "direct" | `team:<id>` */
  value: string;
  label: string;
}

function watchStateOf(p: PlaylistCardData): Exclude<WatchFilter, "all"> {
  if (p.watchedCount === 0) return "new";
  if (p.clipCount > 0 && p.watchedCount >= p.clipCount) return "watched";
  return "progress";
}

function matchesSource(p: PlaylistCardData, source: string): boolean {
  if (source === "all") return true;
  if (source === "direct") return !!p.isDirect;
  if (source.startsWith("team:")) return (p.teamIds ?? []).includes(source.slice(5));
  return true;
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
}: {
  playlists: PlaylistCardData[];
  sourceOptions: SourceOption[];
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const [watch, setWatch] = useState<WatchFilter>("all");
  const [source, setSource] = useState("all");
  const [sharer, setSharer] = useState("all");

  const byNewest = (a: PlaylistCardData, b: PlaylistCardData) =>
    (b.sharedAt ?? "").localeCompare(a.sharedAt ?? "");
  // Continue-watching order: the playlist touched most recently first, so
  // resuming is always the top card. Falls back to share date.
  const byLastWatched = (a: PlaylistCardData, b: PlaylistCardData) =>
    (b.lastWatchedAt ?? b.sharedAt ?? "").localeCompare(a.lastWatchedAt ?? a.sharedAt ?? "");

  // A "Shared by" filter only earns its place with 2+ distinct sharers.
  const sharerOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of playlists) {
      if (p.sharerId && !byId.has(p.sharerId)) byId.set(p.sharerId, p.sharerName ?? "Unknown");
    }
    if (byId.size < 2) return [];
    return [
      { value: "all", label: "Everyone" },
      ...[...byId].map(([value, label]) => ({ value, label })),
    ];
  }, [playlists]);

  // Sharer + source narrow first, so the chip counts describe what's
  // actually reachable under the current scope rather than the whole library.
  const inSource = useMemo(
    () =>
      playlists
        .filter((p) => sharer === "all" || p.sharerId === sharer)
        .filter((p) => matchesSource(p, source)),
    [playlists, source, sharer],
  );

  const counts = useMemo(() => {
    const c = { all: inSource.length, new: 0, progress: 0, watched: 0 };
    for (const p of inSource) c[watchStateOf(p)] += 1;
    return c;
  }, [inSource]);

  const visible = useMemo(
    () => (watch === "all" ? inSource : inSource.filter((p) => watchStateOf(p) === watch)),
    [inSource, watch],
  );

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
              <span className="text-xs text-muted-foreground">To</span>
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
            When your coach shares clips with you, they&apos;ll show up here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">Nothing here right now.</p>
          <button
            type="button"
            onClick={() => { setWatch("all"); setSource("all"); setSharer("all"); }}
            className="min-h-[36px] text-sm font-medium text-primary"
          >
            Clear filters
          </button>
        </div>
      ) : watch === "all" ? (
        // Unfiltered, the grouping is the point — it answers "what's new?"
        // at a glance without any interaction.
        <div className="flex flex-col gap-8 px-4 py-5 sm:px-6">
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
