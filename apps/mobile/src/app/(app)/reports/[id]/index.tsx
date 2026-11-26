import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { reportJumpItems, JUMP_BAR_MIN_SECTIONS } from "@scoutable/shared/lib/scouting-report";
import { firstUnwatchedClip, inboxReportName, reportGameLabel, reportProgress, sectionClips } from "@scoutable/shared/lib/scouting-report-inbox";
import { rgba } from "@scoutable/shared/lib/theme-derived";
import { teamTint } from "@scoutable/shared/lib/watch-queue";
import { MEDIA_BASE, playerPhotoUrl } from "@scoutable/shared/lib/player-photos";
import { useReports } from "@/lib/reports-store";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { Screen } from "@/components/shell/Screen";
import { GlassBackButton } from "@/components/shell/GlassButton";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/EmptyState";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { JumpBar, ReportSectionView } from "@/components/report/ReportSectionView";
import { WatchHeader, washAlpha } from "@/components/watch/WatchHeader";

/**
 * A scouting report, read on the phone: one scroll, as the web page reads.
 * The team and the game first (the watch screen's header: the team's colour,
 * its name big, how much is watched and one Play button that starts where
 * the reader stopped), the coach's summary, then a sticky row of
 * section chips (from three sections, as the page's jump bar) over the
 * sections themselves. Opening it tells the coach it was read; each clip
 * watched in the player is ticked here and counted for them, which the foot
 * of the page says plainly. No links out: the app shows only the club's own
 * content (App Store 3.1.3(c)).
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reports, loadReport, pageFor, watchedFor, markOpened } = useReports();
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const page = id ? pageFor(id) : null;
  const [failed, setFailed] = useState(false);
  const listed = reports.find((r) => r.id === id) ?? null;

  useEffect(() => {
    if (!id) return;
    setFailed(false);
    // Always fresh on open: the coach may have updated it since it was kept.
    loadReport(id, true).catch(() => setFailed(true));
  }, [id, loadReport]);

  const valid = page?.valid ? page : null;
  useEffect(() => {
    if (id && valid) markOpened(id);
  }, [id, valid, markOpened]);

  const watched = useMemo(() => (id ? watchedFor(id) : new Set<string>()), [id, watchedFor]);
  const report = valid?.report ?? null;
  const progress = useMemo(() => (report ? reportProgress(report, watched) : { watched: 0, total: 0 }), [report, watched]);
  const jumpItems = useMemo(() => (report && report.sections.length >= JUMP_BAR_MIN_SECTIONS ? reportJumpItems(report.sections) : []), [report]);

  // Section offsets in the scroll, for the chips: where to jump, and which is in view.
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());
  const sectionsTop = useRef(0);
  const barHeight = useRef(0);
  const [current, setCurrent] = useState<string | null>(null);
  // The bar's small title comes in once the header's big one has scrolled away.
  const titleOpacity = useSharedValue(0);
  const titleBottom = useRef(Number.POSITIVE_INFINITY);
  const titleShown = useRef(false);
  const scrollY = useRef(0);
  const syncBarTitle = useCallback(() => {
    const show = scrollY.current > titleBottom.current - 4;
    if (show === titleShown.current) return;
    titleShown.current = show;
    titleOpacity.value = reduceMotion ? (show ? 1 : 0) : withTiming(show ? 1 : 0, { duration: 180 });
  }, [titleOpacity, reduceMotion]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      syncBarTitle();
      if (jumpItems.length === 0) return;
      const y = e.nativeEvent.contentOffset.y + barHeight.current + 24;
      let at: string | null = jumpItems[0]?.id ?? null;
      for (const it of jumpItems) {
        const top = offsets.current.get(it.id);
        if (top !== undefined && sectionsTop.current + top <= y) at = it.id;
      }
      setCurrent((c) => (c === at ? c : at));
    },
    [jumpItems, syncBarTitle],
  );
  const jump = useCallback(
    (sectionId: string) => {
      const top = offsets.current.get(sectionId);
      if (top === undefined) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, sectionsTop.current + top - barHeight.current), animated: !reduceMotion });
      setCurrent(sectionId);
    },
    [reduceMotion],
  );

  const play = (sectionId: string, clipId: string | null) =>
    router.push({ pathname: "/reports/[id]/play", params: { id: id!, section: sectionId, ...(clipId ? { clip: clipId } : {}) } });

  const back = <GlassBackButton label="reports" />;

  if (!page && !failed) {
    return (
      <Screen title="" leading={back} glassBar scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </Screen>
    );
  }

  if (!report) {
    return (
      <Screen title="" leading={back} glassBar scroll={false}>
        <StatusScreen
          icon="basketball"
          title={failed ? "This report didn't load" : "This report isn't available"}
          body={failed ? "Check your connection and try again." : "Your coach may have stopped sharing it, or it has expired."}
          actions={
            failed ? (
              <Button onPress={() => id && loadReport(id, true).then(() => setFailed(false), () => setFailed(true))}>Try again</Button>
            ) : (
              <Button onPress={() => router.back()}>Back to reports</Button>
            )
          }
        />
      </Screen>
    );
  }

  const name = listed ? inboxReportName(listed) : report.header.opponent || report.header.title;
  const gameAt = report.header.game?.at ?? listed?.game?.at ?? null;
  const game = gameAt ? reportGameLabel(gameAt) : null;
  const sender = listed?.senderName ?? null;
  const players = report.sections.filter((s) => s.player).length;
  const metaLine = [
    sender ? `From ${sender}` : null,
    players > 0 ? `${players} player${players === 1 ? "" : "s"}` : null,
    progress.total > 0 ? `${progress.total} clip${progress.total === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tint = teamTint(name);
  const photoFor = (sectionId: string) => {
    const p = report.sections.find((x) => x.id === sectionId)?.player;
    return p?.photoKey ? playerPhotoUrl(MEDIA_BASE, p.photoKey, "S1") : null;
  };
  // Play starts where the reader stopped: the first section with a clip not watched yet.
  const withClips = report.sections.filter((s) => sectionClips(s).length > 0);
  const nextSection = withClips.find((s) => sectionClips(s).some((c) => !watched.has(c.clipKey))) ?? withClips[0] ?? null;
  const playNext = () => {
    if (nextSection) play(nextSection.id, firstUnwatchedClip(sectionClips(nextSection), watched));
  };
  const started = progress.watched > 0 && progress.watched < progress.total;

  return (
    <Screen title={name} leading={back} glassBar titleOpacity={titleOpacity} barWash={rgba(tint, washAlpha(resolvedMode))} scroll={false}>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="pb-12"
        stickyHeaderIndices={jumpItems.length > 0 ? [1] : undefined}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        <WatchHeader
          color={tint}
          title={name}
          meta={metaLine}
          watched={progress.watched}
          total={progress.total}
          action={nextSection ? (started ? "resume" : "play") : null}
          onAction={playNext}
          onTitleLayout={(bottom) => {
            titleBottom.current = bottom;
            syncBarTitle();
          }}
          top={
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 shrink flex-row items-center gap-1.5">
                <Icon name="basketball" size={14} color={colors.mutedForeground} />
                <Text variant="caption" numberOfLines={1} className="uppercase tracking-widest text-muted-foreground">
                  Scouting report
                </Text>
              </View>
              {game ? (
                <View className="shrink-0 rounded-full px-2.5 py-1" style={{ backgroundColor: rgba(tint, 0.14) }}>
                  <Text variant="caption" nums style={{ color: tint }}>
                    {game}
                  </Text>
                </View>
              ) : null}
            </View>
          }
        >
          {report.header.intro ? <Text className="mt-3">{report.header.intro}</Text> : null}
        </WatchHeader>

        {jumpItems.length > 0 ? (
          <View onLayout={(e) => (barHeight.current = e.nativeEvent.layout.height)}>
            <JumpBar items={jumpItems} current={current ?? jumpItems[0].id} onJump={jump} photoFor={photoFor} />
          </View>
        ) : null}

        <View onLayout={(e) => (sectionsTop.current = e.nativeEvent.layout.y)}>
          {report.sections.map((s, i) => (
            <View
              key={s.id}
              onLayout={(e) => offsets.current.set(s.id, e.nativeEvent.layout.y)}
              style={i > 0 ? { borderTopWidth: 0.5, borderTopColor: colors.separator, marginHorizontal: 0 } : undefined}
            >
              <ReportSectionView section={s} watched={watched} tint={tint} coach={sender} onPlay={(clipId) => play(s.id, clipId)} />
            </View>
          ))}
        </View>

        <Text variant="footnote" className="px-8 pt-4 text-center text-muted-foreground">
          Your coach sees when you open this report and which clips you watch.
        </Text>
      </ScrollView>
    </Screen>
  );
}
