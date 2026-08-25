/**
 * Port of apps/web/src/components/playlist/PlaylistFeed.tsx: watch-state
 * chips + From/To filters + New / In progress / Watched sections.
 */
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { PlaylistCard, type PlaylistCardData } from "./PlaylistCard";
import { Select, type SelectOption } from "./Select";

type WatchFilter = "all" | "new" | "progress" | "watched";

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
    <View className="gap-3">
      {title && (
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
          {title} <Text className="font-normal opacity-60">{playlists.length}</Text>
        </Text>
      )}
      <View className="gap-3">
        {playlists.map((p) => (
          <PlaylistCard
            key={p.id}
            playlist={p}
            onOpen={() => onOpen(p.id)}
            onResume={onResume ? () => onResume(p.id) : undefined}
          />
        ))}
      </View>
    </View>
  );
}

export function PlaylistFeed({
  playlists,
  sourceOptions,
  onOpen,
  onResume,
  refreshing,
  onRefresh,
}: {
  playlists: PlaylistCardData[];
  sourceOptions: SelectOption[];
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [watch, setWatch] = useState<WatchFilter>("all");
  const [source, setSource] = useState("all");
  const [sharer, setSharer] = useState("all");

  const byNewest = (a: PlaylistCardData, b: PlaylistCardData) =>
    (b.sharedAt ?? "").localeCompare(a.sharedAt ?? "");
  // Continue-watching order: the playlist touched most recently first.
  const byLastWatched = (a: PlaylistCardData, b: PlaylistCardData) =>
    (b.lastWatchedAt ?? b.sharedAt ?? "").localeCompare(a.lastWatchedAt ?? a.sharedAt ?? "");

  // A "Shared by" filter only earns its place with 2+ distinct sharers.
  const sharerOptions = useMemo<SelectOption[]>(() => {
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
    [playlists, source, sharer]
  );

  const counts = useMemo(() => {
    const c = { all: inSource.length, new: 0, progress: 0, watched: 0 };
    for (const p of inSource) c[watchStateOf(p)] += 1;
    return c;
  }, [inSource]);

  const visible = useMemo(
    () => (watch === "all" ? inSource : inSource.filter((p) => watchStateOf(p) === watch)),
    [inSource, watch]
  );

  const chips: { key: WatchFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "progress", label: "In progress" },
    { key: "watched", label: "Watched" },
  ];

  const hasAnything = playlists.length > 0;

  return (
    <View className="flex-1">
      {hasAnything && (
        <View className="border-b border-border dark:border-border-dark">
          {(sharerOptions.length > 0 || sourceOptions.length > 1) && (
            <View className="flex-row items-center justify-end gap-2 px-4 pt-1 pb-2">
              {sharerOptions.length > 0 && (
                <Select prefix="From" options={sharerOptions} value={sharer} onChange={setSharer} />
              )}
              {sourceOptions.length > 1 && (
                <Select prefix="To" options={sourceOptions} value={source} onChange={setSource} />
              )}
            </View>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-1.5 px-4 pb-3 pt-1"
          >
            {chips.map((c) => {
              const active = watch === c.key;
              return (
                <Pressable
                  key={c.key}
                  accessibilityRole="button"
                  onPress={() => setWatch(c.key)}
                  className={`min-h-[36px] flex-row items-center gap-1.5 rounded-full px-3 ${
                    active ? "bg-primary dark:bg-primary-dark" : "bg-muted dark:bg-muted-dark"
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      active
                        ? "text-primary-foreground dark:text-primary-foreground-dark"
                        : "text-muted-foreground dark:text-muted-foreground-dark"
                    }`}
                  >
                    {c.label} {counts[c.key]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerClassName="flex-grow"
      >
        {!hasAnything ? (
          <View className="flex-1 items-center justify-center gap-3 px-6 py-16">
            <Text className="text-sm font-medium text-foreground dark:text-foreground-dark">
              No playlists yet
            </Text>
            <Text className="max-w-xs text-center text-sm text-muted-foreground dark:text-muted-foreground-dark">
              When your coach shares clips with you, they&apos;ll show up here.
            </Text>
          </View>
        ) : visible.length === 0 ? (
          <View className="items-center gap-2 px-6 py-16">
            <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Nothing here right now.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setWatch("all");
                setSource("all");
                setSharer("all");
              }}
              className="min-h-[36px] justify-center"
            >
              <Text className="text-sm font-medium text-primary dark:text-primary-dark">
                Clear filters
              </Text>
            </Pressable>
          </View>
        ) : watch === "all" ? (
          // Unfiltered, the grouping is the point — it answers "what's new?" at a glance.
          <View className="gap-8 px-4 py-5">
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
          </View>
        ) : (
          // With a chip active the section header would just repeat it — flat list.
          <View className="px-4 py-5">
            <Section
              playlists={[...visible].sort(watch === "progress" ? byLastWatched : byNewest)}
              onOpen={onOpen}
              onResume={watch === "progress" ? onResume : undefined}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
