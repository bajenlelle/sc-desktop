import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import { playerName } from "@scoutable/shared/lib/events";
import { buildWatchItems, clipKey, firstUnwatchedKey, isMultiGame, watchProgress } from "@scoutable/shared/lib/watch-queue";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { useThemeColors } from "@/lib/theme-context";
import { useClipQueue } from "@/hooks/use-clip-queue";
import { PlayerStage } from "@/components/player/PlayerStage";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { ActivePill, EventBadge, WatchClipRow, WatchTextCardRow, clipMeta, useActivePill } from "@/components/WatchClipRow";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Text } from "@/components/ui/Text";

/**
 * Watching a shared playlist (the web's watch-view.tsx at phone width): the
 * player under the navigation bar, then what's playing (with the coach's
 * note right under the footage, where the eye already is) and the clip
 * list, which scroll beneath it. Full screen turns the phone to landscape.
 */
export default function WatchScreen() {
  const { id, resume } = useLocalSearchParams<{ id: string; resume?: string }>();
  const { activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const { allPlaylists, loading, matchLookup, clipViews, recordWatched, refresh } = usePlaylists();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const fullscreen = useStageFullscreen();
  const [scrubbing, setScrubbing] = useState(false);

  const playlist = useMemo(() => allPlaylists.find((p) => p.id === id) ?? null, [allPlaylists, id]);

  // A push tap can land here for a share newer than the mounted store
  // snapshot: one refetch before declaring the playlist unavailable.
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

  // The plays behind the playlist's clips; clips not uploaded yet, or whose
  // play the game data no longer has, are left out (buildWatchItems).
  const items = useMemo(() => {
    if (!playlist) return [];
    const eventByKey = new Map<string, PlayByPlayEvent>();
    for (const item of playlist.items) {
      if (item.type !== "clip") continue;
      const event = matchLookup.get(item.matchId)?.events.find((e) => e.eventId === item.eventId);
      if (event) eventByKey.set(clipKey(item.matchId, item.eventId), event);
    }
    return buildWatchItems(playlist, eventByKey);
  }, [playlist, matchLookup]);

  const multiGame = useMemo(() => isMultiGame(items), [items]);
  const matchTitleFor = useCallback(
    (matchId: string) => (multiGame ? matchLookup.get(matchId)?.title : undefined),
    [multiGame, matchLookup],
  );
  const progress = useMemo(() => (playlist ? watchProgress(playlist, clipViews) : { watched: 0, total: 0 }), [playlist, clipViews]);
  /** Where Play and Resume start: the first clip not yet watched. */
  const startKey = useMemo(() => (playlist ? firstUnwatchedKey(playlist, clipViews) : null), [playlist, clipViews]);

  const playlistId = playlist?.id ?? null;
  const onWatched = useCallback(
    (matchId: string, eventId: number) => {
      if (playlistId) recordWatched(playlistId, matchId, eventId);
    },
    [playlistId, recordWatched],
  );
  const queue = useClipQueue({ items, onWatched });
  const activeClip = queue.activeItem?.kind === "clip" ? queue.activeItem : null;
  const activeCard = queue.activeItem?.kind === "text" ? queue.activeItem.card : null;

  const { playFrom } = queue;
  const playOrResume = useCallback(() => {
    if (items.length > 0) playFrom(startKey ?? items[0].key);
  }, [items, startKey, playFrom]);

  // Resume (the feed's Resume button, or a deep link) starts at its clip once
  // the list is there. Each target is used once, so re-renders don't restart
  // playback, but a new one on a mounted screen still works.
  const consumedResumeRef = useRef<string | null>(null);
  useEffect(() => {
    const target = typeof resume === "string" && resume.length > 0 ? resume : null;
    if (!target || consumedResumeRef.current === target || items.length === 0) return;
    consumedResumeRef.current = target;
    playFrom(target);
  }, [resume, items.length, playFrom]);

  const onTogglePlay = () => {
    if (!queue.isQueueActive) playOrResume();
    else if (activeCard) queue.toggleCard();
    else queue.togglePlayback();
  };

  // Keep the playing row in view as the queue advances.
  const pill = useActivePill(queue.activeKey);
  const scrollRef = useRef<ScrollView>(null);
  const scroll = useRef({ y: 0, height: 0, rowsY: 0 });
  const { frames } = pill;
  useEffect(() => {
    if (!queue.activeKey) return;
    const f = frames.current.get(queue.activeKey);
    if (!f) return;
    const s = scroll.current;
    const top = s.rowsY + f.y;
    const bottom = top + f.height;
    if (top < s.y) scrollRef.current?.scrollTo({ y: Math.max(0, top - 8), animated: !reduceMotion });
    else if (bottom > s.y + s.height) scrollRef.current?.scrollTo({ y: bottom - s.height + 8, animated: !reduceMotion });
  }, [queue.activeKey, frames, reduceMotion]);

  if (!playlist && (loading || retrying)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: true, title: "" }} />
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (!playlist) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: "" }} />
        <StatusScreen
          icon="playlists"
          title="This playlist isn't available"
          body="It may have been removed, or shared with a different team."
          actions={<Button onPress={() => router.back()}>Back to playlists</Button>}
        />
      </>
    );
  }

  const idleLabel =
    items.length > 0 && !queue.isQueueActive ? (progress.watched > 0 && progress.watched < progress.total ? "Resume" : "Play") : null;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: !fullscreen.active,
          title: playlist.name,
          headerTransparent: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: { color: colors.foreground },
          // The back swipe only from the edge (iOS 26's full-width swipe would
          // take the scrubber's drag), and not at all while scrubbing or in full screen.
          fullScreenGestureEnabled: false,
          gestureEnabled: !fullscreen.active && !scrubbing,
          autoHideHomeIndicator: fullscreen.active,
          navigationBarHidden: fullscreen.active,
        }}
      />
      <StatusBar hidden={fullscreen.active} animated />

      {/* Upright, the player sits under the bar at 16:9; in full screen the
          same view fills the window, so playback carries on untouched. */}
      <View style={fullscreen.active ? [StyleSheet.absoluteFill, { zIndex: 10 }] : { width: "100%", aspectRatio: 16 / 9 }}>
        <PlayerStage
          player={queue.player}
          duration={activeClip ? queue.duration : null}
          paused={activeCard ? queue.cardPaused : !queue.isQueueActive || queue.paused}
          onTogglePlay={onTogglePlay}
          transport={{
            isQueueActive: queue.isQueueActive,
            canPrev: queue.canPrev,
            canNext: queue.canNext,
            onPrev: queue.prev,
            onNext: queue.next,
            onReplay: queue.replay,
            onStop: queue.stop,
          }}
          speed={queue.speed}
          onSpeedChange={queue.setSpeed}
          fullscreen={fullscreen}
          title={playlist.name}
          position={queue.position >= 0 ? { index: queue.position, total: items.length } : null}
          buffering={!!activeClip && queue.loading}
          failed={!!activeClip && queue.failed}
          idleLabel={idleLabel}
          cardShowing={!!activeCard}
          onScrubbingChange={setScrubbing}
        >
          {activeCard && (
            <View className="absolute inset-0 items-center justify-center bg-black px-8">
              <Text
                className="text-center font-semibold text-white"
                style={fullscreen.active ? { fontSize: 34, lineHeight: 41 } : { fontSize: 24, lineHeight: 32 }}
              >
                {activeCard.text}
              </Text>
            </View>
          )}
        </PlayerStage>
      </View>

      <ScrollView
        ref={scrollRef}
        // Under the full-screen player, out of reach and out of VoiceOver's way.
        accessibilityElementsHidden={fullscreen.active}
        importantForAccessibility={fullscreen.active ? "no-hide-descendants" : "auto"}
        className="flex-1"
        contentContainerClassName="pb-10"
        scrollEventThrottle={32}
        onScroll={(e) => {
          scroll.current.y = e.nativeEvent.contentOffset.y;
        }}
        onLayout={(e) => {
          scroll.current.height = e.nativeEvent.layout.height;
        }}
      >
        {activeClip && (
          <View className="gap-2 px-4 pt-3">
            <View className="min-w-0 flex-row items-center gap-2">
              <EventBadge event={activeClip.event} large />
              <Text variant="title3" numberOfLines={1} className="shrink">
                {playerName(activeClip.event)}
              </Text>
            </View>
            <Text variant="callout" nums className="text-muted-foreground">
              {clipMeta(activeClip.event, matchTitleFor(activeClip.matchId))}
            </Text>
            {activeClip.note ? (
              <View className="rounded-window bg-fill-1 px-3.5 py-2.5">
                <Text variant="subheadline" className="text-muted-foreground">
                  Note from your coach
                </Text>
                <Text className="mt-0.5">{activeClip.note}</Text>
              </View>
            ) : null}
          </View>
        )}

        <View className="flex-row items-center gap-3 px-4 pb-2 pt-4">
          <Text variant="headline">Clips</Text>
          {progress.total > 0 && (
            <>
              <ProgressBar value={progress.watched / progress.total} height={4} className="flex-1" />
              <Text variant="subheadline" nums className="shrink-0 text-muted-foreground">
                {progress.watched} of {progress.total} watched
              </Text>
            </>
          )}
        </View>

        {items.length === 0 ? (
          <Text variant="callout" className="px-6 py-8 text-center text-muted-foreground">
            {isCoachOrAdmin ? "No clips to watch yet." : "No clips to watch yet. Your coach may still be uploading."}
          </Text>
        ) : (
          <View
            onLayout={(e) => {
              scroll.current.rowsY = e.nativeEvent.layout.y;
            }}
          >
            <ActivePill style={pill.style} />
            {items.map((item) =>
              item.kind === "text" ? (
                <WatchTextCardRow
                  key={item.key}
                  card={item.card}
                  active={queue.activeKey === item.key}
                  onPlay={() => playFrom(item.key)}
                  onLayout={pill.onRowLayout(item.key)}
                />
              ) : (
                <WatchClipRow
                  key={item.key}
                  event={item.event}
                  matchTitle={matchTitleFor(item.matchId)}
                  note={item.note}
                  watched={clipViews.has(clipViewKey(playlist.id, item.matchId, item.event.eventId))}
                  active={queue.activeKey === item.key}
                  onPlay={() => playFrom(item.key)}
                  onLayout={pill.onRowLayout(item.key)}
                />
              ),
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
