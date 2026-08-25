import { Pressable, Text, View } from "react-native";
import { Avatar } from "./Avatar";
import { ProgressBar } from "./ProgressBar";
import { relativeTime } from "@/lib/format";

/** Port of web PlaylistCardData (apps/web .../PlaylistCard.tsx). */
export interface PlaylistCardData {
  id: string;
  name: string;
  clipCount: number;
  watchedCount: number;
  sharedAt?: string;
  /** Newest clip watch — orders "In progress" as continue-watching. */
  lastWatchedAt?: string;
  /** User id of the sharer — drives the "Shared by" filter. */
  sharerId?: string;
  sharerName?: string;
  sharerAvatarUrl?: string;
  /** Shared straight to this player rather than to one of their teams. */
  isDirect?: boolean;
  /** Teams this playlist reached the player through — drives the source filter. */
  teamIds?: string[];
}

export function PlaylistCard({
  playlist,
  onOpen,
  onResume,
}: {
  playlist: PlaylistCardData;
  onOpen: () => void;
  /** Only passed for partially-watched playlists — jumps to the first unwatched clip. */
  onResume?: () => void;
}) {
  const { name, clipCount, watchedCount, sharedAt, sharerName, sharerAvatarUrl } = playlist;
  const isNew = watchedCount === 0;
  const isComplete = clipCount > 0 && watchedCount >= clipCount;
  const pct = clipCount > 0 ? Math.round((watchedCount / clipCount) * 100) : 0;
  const when = relativeTime(sharedAt);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className={`flex-col gap-3 rounded-xl border bg-card dark:bg-card-dark p-4 active:bg-muted dark:active:bg-muted-dark ${
        isNew
          ? "border-primary/40 dark:border-primary-dark/40"
          : "border-border dark:border-border-dark"
      }`}
    >
      <View className="gap-2">
        {isNew && (
          <View className="flex-row">
            <View className="flex-row items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5">
              <View className="h-1.5 w-1.5 rounded-full bg-primary dark:bg-primary-dark" />
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-primary dark:text-primary-dark">
                New
              </Text>
            </View>
          </View>
        )}
        <Text
          numberOfLines={2}
          className="text-base font-semibold text-foreground dark:text-foreground-dark"
        >
          {name}
        </Text>
        <View className="flex-row items-center gap-2">
          <Avatar name={sharerName} url={sharerAvatarUrl} size={20} />
          <Text
            numberOfLines={1}
            className="flex-1 text-xs text-muted-foreground dark:text-muted-foreground-dark"
          >
            {sharerName ?? "Your coach"}
            {when ? ` · ${when}` : ""}
          </Text>
        </View>
      </View>

      {/* Progress only earns its space once there's progress to show. */}
      {!isNew && !isComplete && (
        <View className="gap-1.5">
          <ProgressBar value={pct} />
          <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {watchedCount} of {clipCount} watched
          </Text>
        </View>
      )}

      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {isComplete
            ? `${clipCount} clips · watched`
            : `${clipCount} clip${clipCount === 1 ? "" : "s"}`}
        </Text>
        {onResume && !isNew && !isComplete ? (
          <Pressable
            accessibilityRole="button"
            onPress={onResume}
            className="min-h-[36px] flex-row items-center justify-center gap-1 rounded-md bg-primary dark:bg-primary-dark px-3 active:opacity-80"
          >
            <Text className="text-xs font-medium text-primary-foreground dark:text-primary-foreground-dark">
              ▶ Resume
            </Text>
          </Pressable>
        ) : (
          <Text className="text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
            {isNew ? "Watch ›" : "Open ›"}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
