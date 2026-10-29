/**
 * The watch screen's list rows (the web's playlist/ClipRow.tsx): a clip's
 * event and player, then period, clock, team and (in multi-game playlists)
 * the game; whether it has been watched, and the coach's note in full (the
 * rows are what say what's playing; nothing repeats them under the player).
 * A 3 pt strip in the event's colour makes a long list scannable. The
 * playing row's highlight is one pill that springs from row to row
 * (ActivePill), not a fill that appears and vanishes.
 */
import { useCallback, useEffect, useRef } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { eventColors, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import { rgba } from "@scoutable/shared/lib/theme-derived";
import type { PlayByPlayEvent, PlaylistTextCard } from "@scoutable/shared/types/match";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { springs } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/**
 * eventColors().badge mixes bg-* and text-* utilities meant for one web
 * element; RN doesn't cascade text colour from a View, so they're split
 * between the pill and its label.
 */
function splitBadgeClasses(badge: string): { bg: string; text: string } {
  const parts = badge.split(" ");
  return {
    bg: parts.filter((c) => c.startsWith("bg-") || c.startsWith("dark:bg-")).join(" "),
    text: parts.filter((c) => c.startsWith("text-") || c.startsWith("dark:text-")).join(" "),
  };
}

/** The event's pill: "Made 3PT", "Turnover"… */
function EventBadge({ event }: { event: PlayByPlayEvent }) {
  const badge = splitBadgeClasses(eventColors(event).badge);
  return (
    <View className={cn("shrink-0 rounded-full px-2 py-px", badge.bg)}>
      <Text variant="footnote" className={cn("font-medium", badge.text)}>
        {eventLabel(event)}
      </Text>
    </View>
  );
}

/** "Q2 · 07:41 · Fryshuset · vs Viby", the clip's place in its game. */
function clipMeta(event: PlayByPlayEvent, matchTitle?: string): string {
  return [`Q${event.period}`, formatGameClock(event.gameClockTime), event.eventTeam?.teamName, matchTitle]
    .filter(Boolean)
    .join(" · ");
}

export function WatchClipRow({
  event,
  matchTitle,
  note,
  watched,
  active,
  onPlay,
  onLayout,
}: {
  event: PlayByPlayEvent;
  /** Shown in multi-game playlists only. */
  matchTitle?: string;
  note?: string;
  watched: boolean;
  active: boolean;
  onPlay: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const colors = useThemeColors();
  const meta = clipMeta(event, matchTitle);
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={[eventLabel(event), playerName(event), meta, note ? `note from your coach: ${note}` : null, watched ? "watched" : null]
        .filter(Boolean)
        .join(", ")}
      onPress={onPlay}
      onLayout={onLayout}
      className={({ pressed }) => cn("min-h-14 flex-row items-stretch gap-2 pr-4", pressed && !active && "bg-fill-2")}
    >
      <View className={cn("w-[3px] shrink-0", eventColors(event).strip)} />
      <View className="min-w-0 flex-1 justify-center gap-0.5 py-2 pl-1">
        <View className="min-w-0 flex-row items-center gap-1.5">
          <EventBadge event={event} />
          <Text variant="subheadline" numberOfLines={1} className="shrink font-medium">
            {playerName(event)}
          </Text>
        </View>
        <Text variant="subheadline" nums numberOfLines={1} className="text-muted-foreground">
          {meta}
        </Text>
        {note ? (
          <View className="mt-1 min-w-0 flex-row items-start gap-1.5">
            <Icon name="note" size={14} color={colors.primary} style={{ opacity: 0.7, marginTop: 3 }} />
            <Text variant="subheadline" className="shrink text-foreground/80">
              {note}
            </Text>
          </View>
        ) : null}
      </View>
      <View className="shrink-0 flex-row items-center">
        {active ? (
          <Icon name="play" size={14} color={colors.primary} />
        ) : watched ? (
          <Icon name="check" size={14} weight="semibold" color={colors.mutedForeground} />
        ) : (
          <View style={{ width: 14 }} />
        )}
      </View>
    </Tappable>
  );
}

export function WatchTextCardRow({
  card,
  active,
  onPlay,
  onLayout,
}: {
  card: PlaylistTextCard;
  active: boolean;
  onPlay: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Text card: ${card.text || "Text card"}`}
      onPress={onPlay}
      onLayout={onLayout}
      className={({ pressed }) => cn("min-h-14 flex-row items-stretch gap-2 pr-4", pressed && !active && "bg-fill-2")}
    >
      <View className="w-[3px] shrink-0 bg-fill-3" />
      <View className="min-w-0 flex-1 flex-row items-center gap-2 py-2 pl-1">
        <Icon name="textCard" size={14} color={colors.mutedForeground} />
        <Text variant="subheadline" numberOfLines={2} className="shrink italic text-muted-foreground">
          {card.text || "Text card"}
        </Text>
      </View>
      {active && (
        <View className="shrink-0 justify-center">
          <Icon name="play" size={14} color={colors.primary} />
        </View>
      )}
    </Tappable>
  );
}

/**
 * The playing row's highlight: rows report where they sit, and the pill
 * springs to the active one (no spring on its first appearance).
 */
export function useActivePill(activeKey: string | null) {
  const frames = useRef(new Map<string, { y: number; height: number }>());
  const y = useSharedValue(0);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);

  const place = useCallback(
    (key: string, animate: boolean) => {
      const f = frames.current.get(key);
      if (!f) return;
      if (animate && opacity.value === 1) {
        y.value = withSpring(f.y, springs.standard);
        height.value = withSpring(f.height, springs.standard);
      } else {
        y.value = f.y;
        height.value = f.height;
      }
      opacity.value = 1;
    },
    [y, height, opacity],
  );

  useEffect(() => {
    if (!activeKey) {
      opacity.value = 0;
      return;
    }
    place(activeKey, true);
  }, [activeKey, place, opacity]);

  const onRowLayout = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      const { y: rowY, height: h } = e.nativeEvent.layout;
      frames.current.set(key, { y: rowY, height: h });
      if (key === activeKey) place(key, false);
    },
    [activeKey, place],
  );

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value + 2 }],
    height: Math.max(0, height.value - 4),
  }));

  return { frames, onRowLayout, style };
}

export function ActivePill({ style }: { style: ReturnType<typeof useActivePill>["style"] }) {
  const colors = useThemeColors();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left: 4, right: 4, top: 0, borderRadius: 6, backgroundColor: rgba(colors.primary, 0.12) },
        style,
      ]}
    />
  );
}
