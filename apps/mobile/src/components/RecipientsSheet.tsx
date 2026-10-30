import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { behindRecipients, dashboardScopeLabel, type DashboardRow, type RecipientRow } from "@scoutable/shared/lib/shared-by-me";
import { relativeTime } from "@/lib/format";
import { useThemeColors } from "@/lib/theme-context";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/ui/Icon";
import { TextButton } from "@/components/ui/Row";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { WatchBar } from "@/components/ui/WatchBar";

/** "1 of 7 finished · 2 watching", or why there is nothing to count. */
export function progressLine(row: DashboardRow): string {
  const total = row.recipients.length;
  if (total === 0) return "Not shared with anyone yet";
  const watching = Math.max(0, row.startedCount - row.completedCount);
  return [`${row.completedCount} of ${total} finished`, watching > 0 ? `${watching} watching` : null].filter(Boolean).join(" · ");
}

/**
 * A shared playlist opened from Shared by me: where it went and how far
 * everyone got, then the people still watching first (with Remind), the
 * finished folded into one line until asked for, and at the foot Remind all
 * and Watch as a player. A sheet, so the list behind stays as it was.
 */
export function RecipientsSheet({
  row,
  visible,
  onClose,
  remindState,
  onRemind,
  onRemindPlaylist,
  remindingPlaylist,
  remindBusy,
}: {
  row: DashboardRow | null;
  visible: boolean;
  onClose: () => void;
  remindState: Map<string, "sending" | "sent">;
  onRemind: (r: RecipientRow) => void;
  /** Reminds everyone behind on this playlist. */
  onRemindPlaylist: () => void;
  remindingPlaylist: boolean;
  remindBusy: boolean;
}) {
  const colors = useThemeColors();
  const [showFinished, setShowFinished] = useState(false);
  useEffect(() => {
    if (visible) setShowFinished(false);
  }, [visible, row?.playlist.id]);
  if (!row) return null;

  const total = row.recipients.length;
  const behind = behindRecipients(row);
  const reach = dashboardScopeLabel(row);
  const when = relativeTime(row.newestSharedAt ?? undefined);
  const isDone = (r: RecipientRow) => row.playableCount > 0 && r.watched >= row.playableCount;
  const finished = row.recipients.filter(isDone);
  const shown = showFinished ? row.recipients : row.recipients.filter((r) => !isDone(r));
  const hairline = { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={row.playlist.name}
      trailing={<TextButton label="Done" size="body" onPress={onClose} />}
    >
      <View className="px-4 pb-3">
        <Text variant="subheadline" className="text-muted-foreground">
          {[reach || "No recipients", when ? `shared ${when}` : null].filter(Boolean).join(" · ")}
        </Text>
        {total > 0 ? (
          <View className="mt-3 flex-row items-center gap-3">
            <WatchBar done={row.completedCount} started={row.startedCount} total={total} className="flex-1" />
            <Text variant="footnote" nums className="text-muted-foreground">
              {progressLine(row)}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={hairline} />

      {total === 0 ? (
        <Text variant="subheadline" className="px-4 py-3 text-muted-foreground">
          No recipients yet. Share this playlist with a team or a player.
        </Text>
      ) : (
        <View className="pt-1">
          {shown.map((r, i) => {
            const done = isDone(r);
            const active = relativeTime(r.lastActivity ?? undefined);
            const state = remindState.get(`${row.playlist.id}:${r.userId}`);
            return (
              <View key={r.userId}>
                {i > 0 && <View style={[hairline, { marginLeft: 56 }]} />}
                <View className="min-h-12 flex-row items-center gap-3 px-4 py-1.5">
                  <Avatar name={r.name} url={r.avatarUrl ?? undefined} size={28} />
                  <View className="min-w-0 flex-1">
                    <Text variant="subheadline" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text variant="footnote" className="text-muted-foreground">
                      {active ? `Active ${active}` : "No activity yet"}
                    </Text>
                  </View>
                  <Text variant="subheadline" nums className="text-muted-foreground">
                    {done ? "Finished" : r.watched > 0 ? `${r.watched} of ${row.playableCount}` : "Not started"}
                  </Text>
                  {done ? (
                    <Icon name="check" size={16} strokeWidth={2} color={colors.mutedForeground} />
                  ) : state === "sent" ? (
                    <Text variant="subheadline" className="text-muted-foreground">
                      Reminded
                    </Text>
                  ) : (
                    <TextButton label="Remind" disabled={state === "sending"} accessibilityLabel={`Remind ${r.name}`} onPress={() => onRemind(r)} />
                  )}
                </View>
              </View>
            );
          })}
          {finished.length > 0 && !showFinished && (
            <View className="px-4 pb-1 pt-2" style={{ paddingLeft: 56 }}>
              <TextButton
                size="footnote"
                muted
                label={
                  finished.length === total
                    ? `All ${total} have finished. Show them`
                    : `${finished.length} ${finished.length === 1 ? "has" : "have"} finished. Show`
                }
                onPress={() => setShowFinished(true)}
              />
            </View>
          )}
        </View>
      )}

      <View style={[hairline, { marginTop: 6 }]} />
      <View className="flex-row items-center justify-between px-4 pt-1">
        {behind.length > 0 ? (
          remindingPlaylist ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <TextButton label={`Remind all ${behind.length}`} disabled={remindBusy} onPress={onRemindPlaylist} />
          )
        ) : (
          <View />
        )}
        <TextButton
          label="Watch as a player"
          accessibilityLabel={`Watch ${row.playlist.name} as a player`}
          onPress={() => {
            onClose();
            router.push(`/playlists/${row.playlist.id}`);
          }}
        />
      </View>
    </Sheet>
  );
}
