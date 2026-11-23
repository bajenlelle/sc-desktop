/**
 * A scouting report in a list: a row on the Scouting reports page, and the
 * card on top of My playlists. Both say the same three things: when the game
 * is (or that the report is new), the team it scouts, and who sent it and how
 * far the reader has watched. The row carries the playlists' status ring so
 * the two lists read alike; the card is the one raised thing on the feed,
 * there only until the game is played and the report read
 * (featuredReport).
 */
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { inboxProgress, inboxReportName, reportGameLabel, type InboxReport } from "@scoutable/shared/lib/scouting-report-inbox";
import { relativeTime } from "@/lib/format";
import { useLargeText } from "@/lib/a11y";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { Dot } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

const GLYPH = 18;

function clipsLabel(n: number): string {
  return `${n} clip${n === 1 ? "" : "s"}`;
}

/** "Coach L · 6 of 16 watched", "New · Coach L · 16 clips", "Coach L · 16 clips · 2d ago". */
export function reportMeta(r: InboxReport): string {
  const who = r.senderName ?? "Your coach";
  const { watched, total } = inboxProgress(r);
  if (watched > 0 && watched < total) return `${who} · ${watched} of ${total} watched`;
  if (watched > 0 && watched >= total) return `${who} · All ${total} watched`;
  return [!r.openedAt ? "New" : null, who, total > 0 ? clipsLabel(total) : null, r.openedAt ? relativeTime(r.sentAt) : null]
    .filter(Boolean)
    .join(" · ");
}

/** The playlists' ring: empty while unread, filling as clips are watched, a check when all are. */
function ReportGlyph({ r }: { r: InboxReport }) {
  const colors = useThemeColors();
  const { watched, total } = inboxProgress(r);
  if (total > 0 && watched >= total) return <Icon name="checkCircle" size={GLYPH} color={colors.mutedForeground} />;
  const rad = (GLYPH - 2) / 2;
  const c = 2 * Math.PI * rad;
  const progress = total > 0 ? watched / total : 0;
  return (
    <Svg width={GLYPH} height={GLYPH} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={GLYPH / 2} cy={GLYPH / 2} r={rad} stroke={!r.openedAt ? colors.mutedForeground : colors.fill3} strokeWidth={1.75} fill="none" />
      {progress > 0 ? (
        <Circle
          cx={GLYPH / 2}
          cy={GLYPH / 2}
          r={rad}
          stroke={colors.primary}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.06, progress) * c} ${c}`}
        />
      ) : null}
    </Svg>
  );
}

export function ReportRow({ report, onOpen }: { report: InboxReport; onOpen: () => void }) {
  const colors = useThemeColors();
  const large = useLargeText();
  const game = report.game ? reportGameLabel(report.game.at) : null;
  const meta = reportMeta(report);
  const name = inboxReportName(report);
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityLabel={[`Scouting report: ${name}`, game ? `game ${game}` : null, meta].filter(Boolean).join(". ")}
      onPress={onOpen}
      className={({ pressed }) => cn("flex-row items-start gap-3.5 px-4 py-3", pressed && "bg-fill-1")}
    >
      <View style={{ marginTop: game ? 20 : 2 }}>
        <ReportGlyph r={report} />
      </View>
      <View className="min-w-0 flex-1">
        {game ? (
          <Text variant="footnote" nums numberOfLines={1} className="text-muted-foreground">
            {game}
          </Text>
        ) : null}
        <Text numberOfLines={large ? 3 : 2}>{name}</Text>
        <Text variant="subheadline" nums numberOfLines={large ? undefined : 1} className="mt-0.5 text-muted-foreground">
          {meta}
        </Text>
      </View>
      {!report.openedAt ? (
        <View style={{ marginTop: game ? 25 : 7 }}>
          <Dot color={colors.primary} />
        </View>
      ) : null}
    </Tappable>
  );
}

/** The card on top of My playlists: the report for what's next. */
export function FeaturedReportCard({ report, onOpen }: { report: InboxReport; onOpen: () => void }) {
  const colors = useThemeColors();
  const game = report.game ? reportGameLabel(report.game.at) : null;
  const name = inboxReportName(report);
  const meta = [
    report.senderName ?? "Your coach",
    report.players > 0 ? `${report.players} player${report.players === 1 ? "" : "s"}` : null,
    report.clips > 0 ? clipsLabel(report.clips) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const { watched, total } = inboxProgress(report);
  return (
    <Tappable
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={[`Scouting report: ${name}`, game ? `game ${game}` : null, !report.openedAt ? "new" : null, meta].filter(Boolean).join(". ")}
      onPress={onOpen}
      className={({ pressed }) => cn("mx-4 mb-3 mt-1 rounded-window border px-4 py-3.5", pressed ? "bg-fill-1" : "bg-card")}
      style={{ borderColor: colors.separator }}
    >
      <View className="flex-row items-center gap-2">
        <Icon name="basketball" size={15} color={colors.mutedForeground} />
        <Text variant="footnote" nums numberOfLines={1} className="min-w-0 flex-1 text-muted-foreground">
          {game ? `Scouting report · ${game}` : "Scouting report"}
        </Text>
        {!report.openedAt ? <Dot color={colors.primary} /> : null}
      </View>
      <Text variant="title3" numberOfLines={2} className="mt-1.5">
        {name}
      </Text>
      <Text variant="subheadline" nums numberOfLines={2} className="mt-0.5 text-muted-foreground">
        {watched > 0 ? `${meta} · ${watched} of ${total} watched` : meta}
      </Text>
    </Tappable>
  );
}
