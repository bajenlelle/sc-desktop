import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Screen } from "@/components/shell/Screen";
import { GlassBackButton } from "@/components/shell/GlassButton";
import { useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import {
  buildWatchItems,
  canScrubPlaylist,
  clipKey,
  firstUnwatchedKey,
  isMultiGame,
  playlistTint,
  watchProgress,
} from "@scoutable/shared/lib/watch-queue";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { spaceForPlaylist } from "@scoutable/shared/lib/orgs";
import { getPlaylistOrgId } from "@scoutable/shared/lib/playlists-db";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { supabase } from "@/lib/supabase";
import { useThemeColors } from "@/lib/theme-context";
import { useClipQueue } from "@/hooks/use-clip-queue";
import { ClipCaption } from "@/components/player/ClipCaption";
import { DrawingLayer } from "@/components/player/DrawingLayer";
import { PlayerStage } from "@/components/player/PlayerStage";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { CardStage } from "@/components/player/CardStage";
import { ActivePill, WatchClipRow, WatchGroupHeader, WatchTextCardRow, useActivePill } from "@/components/WatchClipRow";
import { WatchCover } from "@/components/watch/WatchCover";
import { WatchHeader, type HeaderAction } from "@/components/watch/WatchHeader";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/EmptyState";
import { Text } from "@/components/ui/Text";

/** After a hand scroll, how long the list leaves the playing row where it is. */
const FOLLOW_PAUSE_MS = 6000;

const clipsLabel = (n: number) => `${n} clip${n === 1 ? "" : "s"}`;

/**
 * Watching a shared playlist (the web's watch-view.tsx at phone width): the
 * player under the app's own title bar, and the clip list scrolling beneath it.
 * The playing row says what's playing (it carries the highlight, and the
 * coach's note shows in full in its row): a block between player and list
 * would change height from clip to clip, or vanish for a text card, and move
 * the list under the reader's finger. Full screen turns the phone to
 * landscape.
 */
export default function WatchScreen() {
  const { id, resume } = useLocalSearchParams<{ id: string; resume?: string }>();
  const { activeOrgId, activeOrgRole, user, myOrgs, isPlayerOnly, setActiveOrg } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const { allPlaylists, feedItems, loading, loadedOrgId, matchLookup, clipViews, recordWatched, refresh } = usePlaylists();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const fullscreen = useStageFullscreen();
  const [scrubbing, setScrubbing] = useState(false);

  const playlist = useMemo(() => allPlaylists.find((p) => p.id === id) ?? null, [allPlaylists, id]);
  // Players get a read-only progress line: dragging to the end would count a clip as watched.
  const canScrub = !!playlist && canScrubPlaylist({ userId: user?.id, myOrgs }, playlist);

  // A push tap or a link can name a playlist the mounted store doesn't
  // hold: one shared in another club than the open one (a staff member's
  // feed holds only the open space), or a share newer than the snapshot.
  // Once, before declaring it unavailable: switch to its club, else refetch.
  const resolvedRef = useRef(false);
  const [resolving, setResolving] = useState(false);
  const [spaceTarget, setSpaceTarget] = useState<string | null>(null);
  useEffect(() => {
    if (playlist || loading || resolvedRef.current || !id) return;
    resolvedRef.current = true;
    setResolving(true);
    getPlaylistOrgId(supabase, id)
      .then((orgId) => {
        const target = spaceForPlaylist(orgId, { activeOrgId, myOrgs, playerOnly: isPlayerOnly });
        if (!target) return refresh();
        setSpaceTarget(target);
        setActiveOrg(target);
      })
      .catch(() => {})
      .finally(() => setResolving(false));
  }, [playlist, loading, id, activeOrgId, myOrgs, isPlayerOnly, refresh, setActiveOrg]);
  // After a switch, until the store holds that club's playlists.
  const switching = spaceTarget !== null && loadedOrgId !== spaceTarget;

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
  /** Multi-game playlists: a heading where each run of one game's clips starts (index → title and count). */
  const groups = useMemo(() => {
    const out = new Map<number, { title: string; count: number }>();
    if (!multiGame) return out;
    let current: { title: string; count: number } | null = null;
    let lastMatch: string | null = null;
    items.forEach((item, i) => {
      if (item.kind !== "clip") return;
      if (item.matchId !== lastMatch) {
        lastMatch = item.matchId;
        current = { title: matchLookup.get(item.matchId)?.title ?? "Game", count: 0 };
        out.set(i, current);
      }
      current!.count += 1;
    });
    return out;
  }, [multiGame, items, matchLookup]);
  /** The team behind each play, in the rows only when the list mixes teams. */
  const mixedTeams = useMemo(() => {
    const names = new Set<string>();
    for (const item of items) if (item.kind === "clip" && item.event.eventTeam?.teamName) names.add(item.event.eventTeam.teamName);
    return names.size > 1;
  }, [items]);
  const teamColor = useMemo(() => playlistTint(items, (m) => matchLookup.get(m), id ?? ""), [items, matchLookup, id]);
  const feedItem = useMemo(() => feedItems.find((f) => f.id === id) ?? null, [feedItems, id]);
  const progress = useMemo(() => (playlist ? watchProgress(playlist, clipViews) : { watched: 0, total: 0 }), [playlist, clipViews]);
  /** Where Play and Resume start: the first clip not yet watched. */
  const startKey = useMemo(() => (playlist ? firstUnwatchedKey(playlist, clipViews) : null), [playlist, clipViews]);

  const playlistId = playlist?.id ?? null;
  const onWatched = useCallback(
    (item: { matchId: string; event: PlayByPlayEvent }) => {
      if (playlistId) recordWatched(playlistId, item.matchId, item.event.eventId);
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
  // The bar's small title comes in once the header's big one has scrolled under the player.
  const titleOpacity = useSharedValue(0);
  const titleBottom = useRef(Number.POSITIVE_INFINITY);
  const titleShown = useRef(false);
  const syncBarTitle = useCallback(() => {
    const show = scroll.current.y > titleBottom.current - 4;
    if (show === titleShown.current) return;
    titleShown.current = show;
    titleOpacity.value = reduceMotion ? (show ? 1 : 0) : withTiming(show ? 1 : 0, { duration: 180 });
  }, [titleOpacity, reduceMotion]);
  const { frames } = pill;
  /** A row that should come into view once it has been laid out (a resume lands below the header). */
  const pendingReveal = useRef<string | null>(null);
  /** When the reader last scrolled by hand: the list doesn't move under them for a while after. */
  const lastDrag = useRef(0);
  const revealActive = useCallback(
    (key: string | null) => {
      if (!key) return;
      const f = frames.current.get(key);
      if (!f) {
        pendingReveal.current = key;
        return;
      }
      pendingReveal.current = null;
      const s = scroll.current;
      const top = s.rowsY + f.y;
      const bottom = top + f.height;
      if (top < s.y) scrollRef.current?.scrollTo({ y: Math.max(0, top - 8), animated: !reduceMotion });
      else if (bottom > s.y + s.height) scrollRef.current?.scrollTo({ y: bottom - s.height + 8, animated: !reduceMotion });
    },
    [frames, reduceMotion],
  );
  useEffect(() => {
    if (Date.now() - lastDrag.current < FOLLOW_PAUSE_MS) return;
    revealActive(queue.activeKey);
  }, [queue.activeKey, revealActive]);
  const onRowLayout = useCallback(
    (key: string) => {
      const report = pill.onRowLayout(key);
      return (e: LayoutChangeEvent) => {
        report(e);
        // After this frame, so the list's own offset (rowsY) is in too.
        if (pendingReveal.current === key) requestAnimationFrame(() => revealActive(key));
      };
    },
    [pill, revealActive],
  );

  if (!playlist && (loading || resolving || switching)) {
    return (
      <Screen title="" leading={<GlassBackButton label="playlists" />} glassBar scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </Screen>
    );
  }

  if (!playlist) {
    return (
      <Screen title="" leading={<GlassBackButton label="playlists" />} glassBar scroll={false}>
        <StatusScreen
          icon="playlists"
          title="This playlist isn't available"
          body="It may have been removed, or shared with a different team."
          actions={<Button onPress={() => router.back()}>Back to playlists</Button>}
        />
      </Screen>
    );
  }

  const idleLabel =
    items.length > 0 && !queue.isQueueActive ? (progress.watched > 0 && progress.watched < progress.total ? "Resume" : "Play") : null;
  const queuePaused = activeCard ? queue.cardPaused : queue.paused && !queue.holding;
  const headerAction: HeaderAction | null =
    items.length === 0 ? null : !queue.isQueueActive ? (idleLabel === "Resume" ? "resume" : "play") : queuePaused ? "play" : "pause";
  const shared = relativeTime(feedItem?.sharedAt ?? playlist.sharedAt);
  const cardCount = items.length - items.filter((i) => i.kind === "clip").length;
  const meta = [clipsLabel(progress.total), cardCount > 0 ? `${cardCount} card${cardCount === 1 ? "" : "s"}` : null, shared ? `shared ${shared}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen
      title={playlist.name}
      leading={<GlassBackButton label="playlists" />}
      glassBar
      titleOpacity={titleOpacity}
      scroll={false}
      barHidden={fullscreen.active}
    >
      <Stack.Screen
        options={{
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
          canScrub={canScrub}
          // A held frame is part of playback: the controls read "playing".
          paused={activeCard ? queue.cardPaused : !queue.isQueueActive || (queue.paused && !queue.holding)}
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
          onScrubbingChange={(on) => {
            // A scrub ends a hold where it stands, or its timer would play mid-scrub.
            if (on) queue.cancelHold();
            setScrubbing(on);
          }}
          drawings={activeClip?.drawings}
          slows={activeClip?.slowMotion}
          cover={<WatchCover color={teamColor} playLabel={idleLabel ?? "Play"} onPlay={items.length > 0 ? playOrResume : undefined} />}
        >
          {activeCard && <CardStage key={queue.activeKey} card={activeCard} fullscreen={fullscreen.active} />}
          {queue.shownDrawing && !activeCard && <DrawingLayer key={queue.shownDrawing.id} shapes={queue.shownDrawing.shapes} />}
          {activeClip?.note && !activeCard && <ClipCaption key={activeClip.key} text={activeClip.note} />}
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
        onScrollBeginDrag={() => {
          lastDrag.current = Date.now();
          pendingReveal.current = null;
        }}
        onScrollEndDrag={() => {
          lastDrag.current = Date.now();
        }}
        onScroll={(e) => {
          scroll.current.y = e.nativeEvent.contentOffset.y;
          syncBarTitle();
        }}
        onLayout={(e) => {
          scroll.current.height = e.nativeEvent.layout.height;
        }}
      >
        <WatchHeader
          color={teamColor}
          sharerName={feedItem?.sharerName}
          sharerAvatarUrl={feedItem?.sharerAvatarUrl}
          source={feedItem?.teamNames?.join(", ")}
          title={playlist.name}
          meta={meta}
          watched={progress.watched}
          total={progress.total}
          action={headerAction}
          onAction={onTogglePlay}
          onTitleLayout={(bottom) => {
            titleBottom.current = bottom;
            syncBarTitle();
          }}
        />

        {items.length === 0 ? (
          <Text variant="subheadline" className="px-6 py-8 text-center text-muted-foreground">
            {isCoachOrAdmin ? "No clips to watch yet." : "No clips to watch yet. Your coach may still be uploading."}
          </Text>
        ) : (
          <View
            onLayout={(e) => {
              scroll.current.rowsY = e.nativeEvent.layout.y;
            }}
          >
            <ActivePill style={pill.style} />
            {items.map((item, i) => {
              const group = groups.get(i);
              const row =
                item.kind === "text" ? (
                  <WatchTextCardRow
                    key={item.key}
                    card={item.card}
                    active={queue.activeKey === item.key}
                    onPlay={() => playFrom(item.key)}
                    onLayout={onRowLayout(item.key)}
                  />
                ) : (
                  <WatchClipRow
                    key={item.key}
                    event={item.event}
                    team={mixedTeams ? item.event.eventTeam?.teamName : undefined}
                    note={item.note}
                    drawings={item.drawings?.length ?? 0}
                    watched={clipViews.has(clipViewKey(playlist.id, item.matchId, item.event.eventId))}
                    active={queue.activeKey === item.key}
                    onPlay={() => playFrom(item.key)}
                    onLayout={onRowLayout(item.key)}
                  />
                );
              return group ? [<WatchGroupHeader key={`g-${item.key}`} title={group.title} count={group.count} />, row] : row;
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
