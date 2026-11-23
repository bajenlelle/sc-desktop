import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useReducedMotion } from "react-native-reanimated";
import { eventHue } from "@scoutable/shared/lib/events";
import { MEDIA_BASE } from "@scoutable/shared/lib/player-photos";
import { reportJumpItems, reportSectionTitle } from "@scoutable/shared/lib/scouting-report";
import { clipsProgress, firstUnwatchedClip, reportQueueClips, sectionClips, type ReportQueueClip } from "@scoutable/shared/lib/scouting-report-inbox";
import { useReports } from "@/lib/reports-store";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { useClipQueue } from "@/hooks/use-clip-queue";
import { ClipCaption } from "@/components/player/ClipCaption";
import { DrawingLayer } from "@/components/player/DrawingLayer";
import { PlayerStage } from "@/components/player/PlayerStage";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { ActivePill, useActivePill } from "@/components/WatchClipRow";
import { Screen } from "@/components/shell/Screen";
import { BackButton } from "@/components/shell/BackButton";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Dot } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

/** A report clip's row: what the play was and when, the coach's labels, and whether it's been watched. */
function ReportClipRow({
  item,
  watched,
  active,
  onPlay,
  onLayout,
}: {
  item: ReportQueueClip;
  watched: boolean;
  active: boolean;
  onPlay: () => void;
  onLayout: ReturnType<ReturnType<typeof useActivePill>["onRowLayout"]>;
}) {
  const colors = useThemeColors();
  const c = item.clip;
  const meta = [[c.period, c.clock].filter(Boolean).join(" "), c.game, ...c.labels].filter(Boolean).join(" · ");
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={[c.label, meta, c.note ? `note from your coach: ${c.note}` : null, watched ? "watched" : null].filter(Boolean).join(", ")}
      onPress={onPlay}
      onLayout={onLayout}
      className={({ pressed }) => cn("min-h-14 flex-row items-start gap-3 px-4 py-2", pressed && !active && "bg-fill-1")}
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className={active ? "font-semibold" : undefined}>
          {c.label}
        </Text>
        <View className="min-w-0 flex-row items-center gap-1.5">
          <Dot size={6} color={colors.eventDot[eventHue({ type: c.type, isSuccessful: c.made })]} />
          <Text variant="subheadline" nums numberOfLines={1} className="shrink text-muted-foreground">
            {meta}
          </Text>
          {c.note ? <Icon name="note" size={13} color={colors.mutedForeground} /> : null}
          {c.drawings?.length ? <Icon name="draw" size={13} color={colors.mutedForeground} /> : null}
        </View>
      </View>
      <View className="h-[22px] w-4 shrink-0 items-center justify-center">
        {active ? (
          <Icon name="play" size={14} color={colors.primary} />
        ) : watched ? (
          <Icon name="check" size={16} strokeWidth={2} color={colors.mutedForeground} />
        ) : null}
      </View>
    </Tappable>
  );
}

/**
 * A report section's clips, watched like a playlist (the watch screen's
 * layout and player): the player under the bar, the section's clips beneath,
 * playing on from one to the next. It starts at the clip tapped, or with Play
 * all at the first one not watched yet. Each clip watched is ticked and
 * counted for the coach, by its file.
 */
export default function ReportClipsScreen() {
  const { id, section: sectionId, clip: clipId } = useLocalSearchParams<{ id: string; section: string; clip?: string }>();
  const { pageFor, loadReport, watchedFor, markWatched } = useReports();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const fullscreen = useStageFullscreen();
  const [scrubbing, setScrubbing] = useState(false);

  const page = id ? pageFor(id) : null;
  useEffect(() => {
    if (id && !page) loadReport(id).catch(() => {});
  }, [id, page, loadReport]);
  const report = page?.valid ? page.report : null;
  const section = report?.sections.find((s) => s.id === sectionId) ?? null;
  const items = useMemo(() => (section ? reportQueueClips(section, MEDIA_BASE) : []), [section]);
  const watched = useMemo(() => (id ? watchedFor(id) : new Set<string>()), [id, watchedFor]);
  const progress = useMemo(() => (section ? clipsProgress(sectionClips(section), watched) : { watched: 0, total: 0 }), [section, watched]);
  const title = section
    ? section.player
      ? (reportJumpItems([section])[0]?.label ?? section.player.name)
      : reportSectionTitle(section.kind, section.title)
    : "";

  const onWatched = useCallback(
    (item: ReportQueueClip) => {
      if (id) markWatched(id, item.clip.clipKey);
    },
    [id, markWatched],
  );
  const queue = useClipQueue({ items, onWatched });
  const activeClip = queue.activeItem;

  // Start once the clips are there: at the tapped clip, else where the reader stopped.
  const startedRef = useRef(false);
  const { playFrom } = queue;
  useEffect(() => {
    if (startedRef.current || items.length === 0 || !section) return;
    startedRef.current = true;
    playFrom(clipId ?? firstUnwatchedClip(sectionClips(section), watched) ?? items[0].key);
  }, [items, section, clipId, watched, playFrom]);

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

  const back = <BackButton label="Report" />;

  if (!section) {
    return (
      <Screen title="" leading={back} scroll={false}>
        {page ? (
          <StatusScreen
            icon="basketball"
            title="These clips aren't available"
            body="Your coach may have changed the report or stopped sharing it."
            actions={<Button onPress={() => router.back()}>Back to the report</Button>}
          />
        ) : null}
      </Screen>
    );
  }

  const onTogglePlay = () => {
    if (!queue.isQueueActive) playFrom(firstUnwatchedClip(sectionClips(section), watched) ?? items[0]?.key ?? "");
    else queue.togglePlayback();
  };

  return (
    <Screen title={title} leading={back} scroll={false} barHidden={fullscreen.active}>
      <Stack.Screen
        options={{
          fullScreenGestureEnabled: false,
          gestureEnabled: !fullscreen.active && !scrubbing,
          autoHideHomeIndicator: fullscreen.active,
          navigationBarHidden: fullscreen.active,
        }}
      />
      <StatusBar hidden={fullscreen.active} animated />

      <View style={fullscreen.active ? [StyleSheet.absoluteFill, { zIndex: 10 }] : { width: "100%", aspectRatio: 16 / 9 }}>
        <PlayerStage
          player={queue.player}
          duration={activeClip ? queue.duration : null}
          // Read-only progress, as players get on playlists: a drag to the end would count the clip.
          canScrub={false}
          paused={!queue.isQueueActive || (queue.paused && !queue.holding)}
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
          title={title}
          position={queue.position >= 0 ? { index: queue.position, total: items.length } : null}
          buffering={!!activeClip && queue.loading}
          failed={!!activeClip && queue.failed}
          idleLabel={!queue.isQueueActive && items.length > 0 ? (progress.watched > 0 && progress.watched < progress.total ? "Resume" : "Play") : null}
          cardShowing={false}
          onScrubbingChange={(on) => {
            if (on) queue.cancelHold();
            setScrubbing(on);
          }}
          drawings={activeClip?.drawings}
          slows={activeClip?.slowMotion}
        >
          {queue.shownDrawing && <DrawingLayer key={queue.shownDrawing.id} shapes={queue.shownDrawing.shapes} />}
          {activeClip?.clip.note ? <ClipCaption key={activeClip.key} text={activeClip.clip.note} /> : null}
        </PlayerStage>
      </View>

      <ScrollView
        ref={scrollRef}
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
        <View className="flex-row items-baseline justify-between gap-3 px-4 pb-1.5 pt-4">
          <Text variant="headline">Clips</Text>
          <Text variant="subheadline" nums className="shrink-0 text-muted-foreground">
            {progress.watched} of {progress.total} watched
          </Text>
        </View>
        <View
          onLayout={(e) => {
            scroll.current.rowsY = e.nativeEvent.layout.y;
          }}
        >
          <ActivePill style={pill.style} />
          {items.map((item, i) => [
            i > 0 ? (
              <View
                key={`sep-${item.key}`}
                style={
                  queue.activeKey !== item.key && queue.activeKey !== items[i - 1].key
                    ? { height: StyleSheet.hairlineWidth, marginLeft: 16, backgroundColor: colors.separator }
                    : { height: StyleSheet.hairlineWidth }
                }
              />
            ) : null,
            <ReportClipRow
              key={item.key}
              item={item}
              watched={watched.has(item.clip.clipKey)}
              active={queue.activeKey === item.key}
              onPlay={() => playFrom(item.key)}
              onLayout={pill.onRowLayout(item.key)}
            />,
          ])}
        </View>
      </ScrollView>
    </Screen>
  );
}
