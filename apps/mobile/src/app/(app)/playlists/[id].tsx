import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { VideoView } from "expo-video";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { playableClips, usePlaylists } from "@/lib/playlists-store";
import {
  itemKey,
  useClipQueue,
  type PlaybackItem,
  isTextCard,
} from "@/hooks/use-clip-queue";
import { ClipRow } from "@/components/ClipRow";
import { PlayerControls } from "@/components/PlayerControls";
import { ReportProblemSheet } from "@/components/ReportProblemSheet";
import { ProgressBar } from "@/components/ProgressBar";
import { TextCardOverlay } from "@/components/TextCardOverlay";

export default function WatchScreen() {
  const { id, resume } = useLocalSearchParams<{ id: string; resume?: string }>();
  const { allPlaylists, loading, matchLookup, clipViews, recordWatched, refresh } = usePlaylists();

  const playlist = useMemo(
    () => allPlaylists.find((p) => p.id === id) ?? null,
    [allPlaylists, id]
  );

  // A push tap can land here for a share newer than the mounted store
  // snapshot — one refetch before declaring the playlist unavailable.
  const retriedRef = useRef(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (playlist || loading || retriedRef.current) return;
    retriedRef.current = true;
    setRetrying(true);
    refresh()
      .catch(() => {})
      .finally(() => setRetrying(false));
  }, [playlist, loading, refresh]);

  // Build display items — clips without r2Url are invisible to recipients
  // (a row they can never play only reads as broken), text cards pass through.
  const displayItems = useMemo((): PlaybackItem[] => {
    if (!playlist) return [];
    const items: PlaybackItem[] = [];
    for (const item of playlist.items) {
      if (item.type === "clip") {
        if (!item.r2Url) continue;
        const match = matchLookup.get(item.matchId);
        const event = match?.events.find((e) => e.eventId === item.eventId);
        if (event) {
          items.push({
            type: "clip",
            event,
            matchId: item.matchId,
            r2Url: item.r2Url,
            note: item.note,
          });
        }
      } else {
        items.push(item);
      }
    }
    return items;
  }, [playlist, matchLookup]);

  // Every display item is playable (unshipped clips were dropped above).
  const playableQueue = displayItems;

  const queue = useClipQueue({
    playlistId: playlist?.id ?? null,
    playableQueue,
    recordWatched,
  });

  // Keep the active row visible as the queue auto-advances — without this a
  // long playlist plays on while the highlight drifts below the fold.
  const listRef = useRef<FlatList<PlaybackItem>>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  useEffect(() => {
    if (!queue.activeKey) return;
    const index = displayItems.findIndex((i) => itemKey(i) === queue.activeKey);
    if (index < 0) return;
    try {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    } catch {
      // Unmeasured rows can throw; onScrollToIndexFailed covers the retry.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.activeKey]);

  // Resume (from the feed's Resume button, or a deep link) starts at the
  // target clip once the queue is populated. Each distinct target is consumed
  // once, so re-renders don't restart playback — but a new resume param on an
  // already-mounted screen still works.
  const consumedResumeRef = useRef<string | null>(null);
  useEffect(() => {
    const target = typeof resume === "string" && resume.length > 0 ? resume : null;
    if (!target || consumedResumeRef.current === target || playableQueue.length === 0) return;
    consumedResumeRef.current = target;
    const idx = playableQueue.findIndex((i) => itemKey(i) === target);
    queue.startQueue(playableQueue, idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, playableQueue]);

  /** Watched/total for this playlist, shown under the controls. */
  const progress = useMemo(() => {
    if (!playlist) return { watched: 0, total: 0 };
    const clips = playableClips(playlist);
    return {
      watched: clips.filter((c) => clipViews.has(clipViewKey(playlist.id, c.matchId, c.eventId)))
        .length,
      total: clips.length,
    };
  }, [playlist, clipViews]);

  if (!playlist && (loading || retrying)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background dark:bg-background-dark">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!playlist) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background dark:bg-background-dark px-6">
        <Text className="text-base text-muted-foreground dark:text-muted-foreground-dark">
          This playlist isn&apos;t available.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="mt-4 min-h-[44px] justify-center"
        >
          <Text className="text-base font-semibold text-primary dark:text-primary-dark">
            Back to playlists
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background dark:bg-background-dark">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-2 pb-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Text className="text-2xl text-foreground dark:text-foreground-dark">‹</Text>
        </Pressable>
        <Text
          numberOfLines={1}
          className="flex-1 text-base font-semibold text-foreground dark:text-foreground-dark"
        >
          {playlist.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send feedback"
          onPress={() => setFeedbackOpen(true)}
          className="min-h-[44px] items-center justify-center rounded-full border border-border dark:border-border-dark px-3"
        >
          <Text className="text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
            Feedback
          </Text>
        </Pressable>
      </View>

      {/* Video area — 16:9, black; custom controls (no native seek UI). */}
      <View className="aspect-video w-full bg-black">
        <VideoView
          player={queue.player}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          nativeControls={false}
        />
        {queue.activeTextCard ? <TextCardOverlay card={queue.activeTextCard} /> : null}
        {!queue.isQueueActive && !queue.activeKey ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Play all"
            onPress={queue.playAll}
            className="absolute inset-0 items-center justify-center"
          >
            <View className="h-16 w-16 items-center justify-center rounded-full bg-white/20">
              <Text className="pl-1 text-3xl text-white">▶</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      <PlayerControls
        isQueueActive={queue.isQueueActive}
        isPaused={queue.isPaused}
        canPrev={queue.canPrev}
        canNext={queue.canNext}
        speed={queue.speed}
        onPlayPause={queue.togglePlayPause}
        onPrev={queue.prev}
        onNext={queue.next}
        onReplay={queue.replay}
        onStop={queue.stop}
        onSpeedChange={queue.setSpeed}
      />

      {progress.total > 0 && (
        <View className="flex-row items-center gap-2 px-4 pb-2">
          <ProgressBar value={(progress.watched / progress.total) * 100} className="flex-1" />
          <Text className="text-xs tabular-nums text-muted-foreground dark:text-muted-foreground-dark">
            {progress.watched}/{progress.total}
          </Text>
        </View>
      )}

      {/* Clip list */}
      <FlatList
        ref={listRef}
        data={displayItems}
        keyExtractor={itemKey}
        onScrollToIndexFailed={(info) => {
          // Rows beyond the render window aren't measured yet — approximate,
          // let it render, then retry the precise scroll.
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              viewPosition: 0.3,
              animated: true,
            });
          }, 250);
        }}
        className="flex-1 border-t border-border dark:border-border-dark"
        ItemSeparatorComponent={() => (
          <View className="h-px bg-border/60 dark:bg-border-dark/60" />
        )}
        renderItem={({ item, index }) => {
          if (isTextCard(item)) {
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => queue.playItem(item)}
                className={`min-h-[48px] flex-row items-center gap-3 px-4 py-2.5 active:bg-muted dark:active:bg-muted-dark ${
                  queue.activeKey === itemKey(item) ? "bg-primary/10" : ""
                }`}
              >
                <Text className="w-5 text-right text-xs tabular-nums text-muted-foreground dark:text-muted-foreground-dark">
                  {index + 1}
                </Text>
                <Text
                  numberOfLines={2}
                  className="flex-1 text-sm italic text-muted-foreground dark:text-muted-foreground-dark"
                >
                  {item.text}
                </Text>
              </Pressable>
            );
          }
          const match = matchLookup.get(item.matchId);
          return (
            <ClipRow
              event={item.event}
              matchTitle={match?.title}
              matchDate={match?.date}
              note={item.note}
              watched={clipViews.has(clipViewKey(playlist.id, item.matchId, item.event.eventId))}
              active={queue.activeKey === itemKey(item)}
              onSelect={() => queue.playItem(item)}
            />
          );
        }}
        ListEmptyComponent={
          <View className="items-center px-6 py-16">
            <Text className="text-center text-sm text-muted-foreground dark:text-muted-foreground-dark">
              No clips to watch yet. Your coach may still be uploading.
            </Text>
          </View>
        }
      />

      <ReportProblemSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </SafeAreaView>
  );
}
