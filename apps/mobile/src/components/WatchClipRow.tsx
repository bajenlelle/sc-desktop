/**
 * The watch screen's list rows: who made the play, then what it was and
 * where it sits in the game (period, clock, team and, in multi-game
 * playlists, the game), the coach's note in full, and whether it has been
 * watched. One 6 pt dot in the event's colour family (eventHue) keeps a long
 * list scannable without painting every row. The playing row's highlight is
 * one pill that springs from row to row (ActivePill).
 */
import { useCallback, useEffect, useRef } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { eventHue, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import { rgba } from "@scoutable/shared/lib/theme-derived";
import type { PlayByPlayEvent, PlaylistTextCard } from "@scoutable/shared/types/match";
import { Icon } from "@/components/ui/Icon";
import { Dot } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { springs } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/** "Made 3PT · Q2 · 07:41 · Fryshuset · vs Viby": what the play was and where. */
function clipMeta(event: PlayByPlayEvent, withLabel: boolean, matchTitle?: string): string {
  return [withLabel ? eventLabel(event) : null, `Q${event.period}`, formatGameClock(event.gameClockTime), event.eventTeam?.teamName, matchTitle]
    .filter(Boolean)
    .join(" · ");
}

/** The trailing mark: playing, watched, or room for one. */
function RowMark({ active, watched }: { active: boolean; watched?: boolean }) {
  const colors = useThemeColors();
  return (
    <View className="h-[22px] w-4 shrink-0 items-center justify-center">
      {active ? (
        <Icon name="play" size={14} color={colors.primary} />
      ) : watched ? (
        <Icon name="check" size={16} strokeWidth={2} color={colors.mutedForeground} />
      ) : null}
    </View>
  );
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
  const player = event.player ? playerName(event) : "";
  // A play without a player (a shot clock violation) is named by the event.
  const title = player || eventLabel(event);
  const meta = clipMeta(event, !!player, matchTitle);
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={[eventLabel(event), player, clipMeta(event, false, matchTitle), note ? `note from your coach: ${note}` : null, watched ? "watched" : null]
        .filter(Boolean)
        .join(", ")}
      onPress={onPlay}
      onLayout={onLayout}
      className={({ pressed }) => cn("min-h-14 flex-row items-start gap-3 px-4 py-2", pressed && !active && "bg-fill-1")}
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className={active ? "font-semibold" : undefined}>
          {title}
        </Text>
        <View className="min-w-0 flex-row items-center gap-1.5">
          <Dot size={6} color={colors.eventDot[eventHue(event)]} />
          <Text variant="subheadline" nums numberOfLines={1} className="shrink text-muted-foreground">
            {meta}
          </Text>
        </View>
        {note ? (
          <View className="mt-1 min-w-0 flex-row items-start gap-1.5">
            <Icon name="note" size={14} color={colors.mutedForeground} style={{ marginTop: 3 }} />
            <Text variant="subheadline" className="shrink text-foreground/80">
              {note}
            </Text>
          </View>
        ) : null}
      </View>
      <RowMark active={active} watched={watched} />
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
      className={({ pressed }) => cn("min-h-11 flex-row items-center gap-3 px-4 py-2", pressed && !active && "bg-fill-1")}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <Icon name="textCard" size={15} color={colors.mutedForeground} />
        <Text variant="subheadline" numberOfLines={2} className="shrink italic text-muted-foreground">
          {card.text || "Text card"}
        </Text>
      </View>
      <RowMark active={active} />
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
        { position: "absolute", left: 8, right: 8, top: 0, borderRadius: 8, backgroundColor: rgba(colors.primary, 0.12) },
        style,
      ]}
    />
  );
}
