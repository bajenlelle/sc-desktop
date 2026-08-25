/**
 * One clip in a player's playlist — port of web ClipRow.tsx. Mobile never
 * renders the unplayable state: clips without r2Url aren't in the list.
 */
import { Pressable, Text, View } from "react-native";
import {
  eventColors,
  eventLabel,
  formatGameClock,
  periodLabel,
  playerName,
} from "@scoutable/shared/lib/events";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";

/**
 * eventColors().badge mixes bg-* and text-* utilities for one web element;
 * RN doesn't cascade text color from a View, so split them between the pill
 * View and its Text.
 */
function splitBadgeClasses(badge: string): { bg: string; text: string } {
  const parts = badge.split(" ");
  return {
    bg: parts.filter((c) => c === "bg-muted" || c.startsWith("bg-") || c.startsWith("dark:bg-")).join(" "),
    text: parts.filter((c) => c.startsWith("text-") || c.startsWith("dark:text-")).join(" "),
  };
}

export function ClipRow({
  event,
  matchTitle,
  matchDate,
  note,
  watched,
  active,
  onSelect,
}: {
  event: PlayByPlayEvent;
  /** Opponent / match title, shown so multi-game playlists stay legible. */
  matchTitle?: string;
  matchDate?: string;
  /** The coach's note on this clip — the actual coaching, so it leads. */
  note?: string;
  watched: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const colors = eventColors(event);
  const badge = splitBadgeClasses(colors.badge);

  const context = [
    event.period ? periodLabel(event.period) : null,
    formatGameClock(event.gameClockTime),
    matchTitle,
    matchDate ? new Date(matchDate).toLocaleDateString("sv-SE") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onSelect}
      className={`min-h-[56px] flex-row items-stretch active:bg-muted dark:active:bg-muted-dark ${
        active ? "bg-primary/10" : ""
      }`}
    >
      {/* Event colour rail — makes a long list scannable at a glance. */}
      <View className={`w-1 shrink-0 ${colors.strip}`} />

      <View className="min-w-0 flex-1 gap-1 px-3 py-2.5">
        <View className="min-w-0 flex-row items-center gap-2">
          {watched ? (
            <Text
              accessibilityLabel="Watched"
              className="w-4 text-xs text-muted-foreground dark:text-muted-foreground-dark"
            >
              ✓
            </Text>
          ) : (
            <View className="w-4" />
          )}
          <View className={`shrink-0 rounded-full px-2 py-0.5 ${badge.bg}`}>
            <Text className={`text-xs font-medium ${badge.text}`}>{eventLabel(event)}</Text>
          </View>
          <Text
            numberOfLines={1}
            className="flex-1 text-sm text-foreground dark:text-foreground-dark"
          >
            {playerName(event)}
          </Text>
        </View>

        {context ? (
          <Text
            numberOfLines={1}
            className="pl-6 text-xs text-muted-foreground dark:text-muted-foreground-dark"
          >
            {context}
          </Text>
        ) : null}

        {note ? (
          <View className="flex-row items-start gap-1.5 pl-6">
            <Text className="text-xs text-primary dark:text-primary-dark">💬</Text>
            <Text
              numberOfLines={2}
              className="flex-1 text-xs text-foreground/80 dark:text-foreground-dark/80"
            >
              {note}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
