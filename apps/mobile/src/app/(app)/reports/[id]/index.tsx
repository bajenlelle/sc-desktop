import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { reportJumpItems, JUMP_BAR_MIN_SECTIONS } from "@scoutable/shared/lib/scouting-report";
import { inboxReportName, reportGameLabel, reportProgress } from "@scoutable/shared/lib/scouting-report-inbox";
import { useReports } from "@/lib/reports-store";
import { useThemeColors } from "@/lib/theme-context";
import { Screen } from "@/components/shell/Screen";
import { BackButton } from "@/components/shell/BackButton";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/EmptyState";
import { Text } from "@/components/ui/Text";
import { JumpBar, ReportSectionView } from "@/components/report/ReportSectionView";

/**
 * A scouting report, read on the phone: one scroll, as the web page reads.
 * The team and the game first, the coach's summary, then a sticky row of
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
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y + barHeight.current + 24;
      let at: string | null = jumpItems[0]?.id ?? null;
      for (const it of jumpItems) {
        const top = offsets.current.get(it.id);
        if (top !== undefined && sectionsTop.current + top <= y) at = it.id;
      }
      setCurrent((c) => (c === at ? c : at));
    },
    [jumpItems],
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

  const back = <BackButton label="Reports" />;

  if (!page && !failed) {
    return (
      <Screen title="" leading={back} scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </Screen>
    );
  }

  if (!report) {
    return (
      <Screen title="" leading={back} scroll={false}>
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
  const clipsLine =
    progress.total > 0 ? (progress.watched > 0 ? `${progress.watched} of ${progress.total} clips watched` : `${progress.total} clips`) : null;
  const metaLine = [sender ? `From ${sender}` : null, game, clipsLine].filter(Boolean).join(" · ");

  return (
    <Screen title="Scouting report" leading={back} scroll={false}>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="pb-12"
        stickyHeaderIndices={jumpItems.length > 0 ? [1] : undefined}
        onScroll={jumpItems.length > 0 ? onScroll : undefined}
        scrollEventThrottle={32}
      >
        <View className="gap-2 px-4 pb-4 pt-3">
          <Text variant="largeTitle" accessibilityRole="header">
            {name}
          </Text>
          {metaLine ? (
            <Text variant="subheadline" nums className="text-muted-foreground">
              {metaLine}
            </Text>
          ) : null}
          {report.header.intro ? <Text className="mt-2">{report.header.intro}</Text> : null}
        </View>

        {jumpItems.length > 0 ? (
          <View onLayout={(e) => (barHeight.current = e.nativeEvent.layout.height)}>
            <JumpBar items={jumpItems} current={current ?? jumpItems[0].id} onJump={jump} />
          </View>
        ) : null}

        <View onLayout={(e) => (sectionsTop.current = e.nativeEvent.layout.y)}>
          {report.sections.map((s, i) => (
            <View
              key={s.id}
              onLayout={(e) => offsets.current.set(s.id, e.nativeEvent.layout.y)}
              style={i > 0 ? { borderTopWidth: 0.5, borderTopColor: colors.separator, marginHorizontal: 0 } : undefined}
            >
              <ReportSectionView section={s} watched={watched} onPlay={(clipId) => play(s.id, clipId)} />
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
