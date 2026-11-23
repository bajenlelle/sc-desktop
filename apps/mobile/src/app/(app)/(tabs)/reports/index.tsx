import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { groupInbox } from "@scoutable/shared/lib/scouting-report-inbox";
import { useReports } from "@/lib/reports-store";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { Screen } from "@/components/shell/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Text } from "@/components/ui/Text";
import { ReportRow } from "@/components/report/ReportRow";

/**
 * Scouting reports: what the coach sent about the teams ahead. Upcoming
 * leads, the next game first; Earlier keeps the ones already played until
 * they expire, so a player can look back over the season. Rows sit on the
 * page as the playlists' do.
 */
export default function ReportsScreen() {
  const { loading, reports, refresh } = useReports();
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const groups = useMemo(() => {
    const { upcoming, earlier } = groupInbox(reports);
    return [
      { key: "upcoming", title: "Upcoming", rows: upcoming },
      { key: "earlier", title: "Earlier", rows: earlier },
    ].filter((g) => g.rows.length > 0);
  }, [reports]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return (
    <Screen title="Scouting reports" menu refreshing={refreshing} onRefresh={onRefresh} contentClassName="pt-1">
      {loading ? (
        <View className="items-center justify-center py-20">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : reports.length === 0 ? (
        <EmptyState
          icon="basketball"
          title="No scouting reports yet"
          body="When your coach sends a report on a team you're about to play, it shows up here."
        />
      ) : (
        groups.map((g, i) => (
          <View key={g.key}>
            <Text variant="subheadline" accessibilityRole="header" className={cn("px-4 pb-1 text-muted-foreground", i === 0 ? "pt-2" : "pt-6")}>
              {g.title}
            </Text>
            {g.rows.map((r) => (
              <ReportRow key={r.id} report={r} onOpen={() => router.push(`/reports/${r.id}`)} />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
