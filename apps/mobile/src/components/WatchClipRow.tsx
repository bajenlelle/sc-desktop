/**
 * The watch screen's list rows, built like a music app's track list: a
 * square tile in front, then who made the play and one quiet line saying
 * what it was and when ("3PT made · Q2 05:12"). The tile carries the play's
 * code in its colour family (eventHue: "3PT", "TO", "REB"), the only colour
 * in the row, so a long list scans at a glance. A watched clip gets a check
 * on its tile and a quieter name; the playing one swaps its code for moving
 * bars and sits on the one neutral pill that springs from row to row
 * (ActivePill). Text and stats cards get the same row with a glyph tile.
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { eventHue, eventLabel, eventShortLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { cardRowSummary } from "@scoutable/shared/lib/stats-card";
import { rgba } from "@scoutable/shared/lib/theme-derived";
import type { PlayByPlayEvent, PlaylistTextCard } from "@scoutable/shared/types/match";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { displayStyle } from "@/lib/fonts";
import { springs } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

const TILE = 44;

/** "3PT made · Q2 05:12 · Viby Basket": what the play was and when (the team only when the list mixes teams). */
function clipMeta(event: PlayByPlayEvent, withLabel: boolean, team?: string): string {
  return [withLabel ? eventLabel(event) : null, `${periodLabel(event.period)} ${formatGameClock(event.gameClockTime)}`, team]
    .filter(Boolean)
    .join(" · ");
}

/** Three bars rising and falling, as a music app marks the playing track; still under Reduce Motion. */
function PlayingBars({ color }: { color: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <View accessible={false} importantForAccessibility="no" style={{ flexDirection: "row", alignItems: "flex-end", gap: 2.5, height: 16 }}>
      {[0, 1, 2].map((i) => (
        <Bar key={i} index={i} color={color} still={reduceMotion} />
      ))}
    </View>
  );
}

const STILL_HEIGHTS = [10, 16, 7];

function Bar({ index, color, still }: { index: number; color: string; still: boolean }) {
  const h = useSharedValue(STILL_HEIGHTS[index]);
  useEffect(() => {
    if (still) {
      h.value = STILL_HEIGHTS[index];
      return;
    }
    h.value = 4;
    h.value = withDelay(
      index * 160,
      withRepeat(withTiming(16, { duration: 420 + index * 70, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
    return () => cancelAnimation(h);
  }, [still, index, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[{ width: 3, borderRadius: 1.5, backgroundColor: color }, style]} />;
}

/**
 * The square in front of a row: a play's code (or a card's glyph) on a soft
 * wash of its colour, a check on its corner once watched, moving bars while
 * it plays.
 */
export function PlayTile({
  code,
  glyph,
  color,
  watched,
  playing,
}: {
  code?: string;
  glyph?: ReactNode;
  /** The colour family; null for a neutral tile (cards). */
  color: string | null;
  watched?: boolean;
  playing: boolean;
}) {
  const colors = useThemeColors();
  const tint = color ?? colors.foreground;
  return (
    <View
      style={{
        width: TILE,
        height: TILE,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color ? rgba(color, 0.15) : colors.fill2,
      }}
    >
      {playing ? (
        <PlayingBars color={colors.primary} />
      ) : code ? (
        <Text
          accessible={false}
          maxFontSizeMultiplier={1.2}
          style={[displayStyle(800), { fontSize: code.length > 2 ? 16 : 18, lineHeight: 20, letterSpacing: 0.2, color: tint }]}
        >
          {code}
        </Text>
      ) : (
        glyph
      )}
      {watched && !playing ? (
        // A ring of the page colour cuts the badge out of the tile.
        <View
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: colors.background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={10} strokeWidth={3} color={colors.background} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** A row's words and trailing marks, shared by clips and cards. */
function RowBody({
  tile,
  title,
  titleLines = 1,
  meta,
  note,
  drawings = 0,
  active,
  watched,
}: {
  tile: ReactNode;
  title: string;
  titleLines?: number;
  meta: string;
  note?: boolean;
  drawings?: number;
  active: boolean;
  watched?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <>
      {tile}
      <View className="min-w-0 flex-1">
        <Text
          variant="callout"
          numberOfLines={titleLines}
          className={cn(active ? "font-semibold" : "font-medium", watched && !active && "text-muted-foreground")}
        >
          {title}
        </Text>
        <Text variant="footnote" nums numberOfLines={1} className="mt-0.5 text-muted-foreground">
          {meta}
        </Text>
      </View>
      {note || drawings > 0 ? (
        <View className="shrink-0 flex-row items-center gap-2">
          {note ? <Icon name="note" size={15} color={colors.mutedForeground} /> : null}
          {drawings > 0 ? <Icon name="draw" size={15} color={colors.mutedForeground} /> : null}
        </View>
      ) : null}
    </>
  );
}

const rowClass = (active: boolean) => ({ pressed }: { pressed: boolean }) =>
  cn("min-h-[60px] flex-row items-center gap-3 px-4 py-2", pressed && !active && "bg-fill-1");

export function WatchClipRow({
  event,
  team,
  note,
  drawings = 0,
  watched,
  active,
  onPlay,
  onLayout,
}: {
  event: PlayByPlayEvent;
  /** The play's team, shown only when the playlist mixes teams. */
  team?: string;
  note?: string;
  /** How many drawings the coach made on the clip. */
  drawings?: number;
  watched: boolean;
  active: boolean;
  onPlay: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const colors = useThemeColors();
  const player = event.player ? playerName(event) : "";
  // A play without a player (a shot clock violation) is named by the event.
  const title = player || eventLabel(event);
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={[
        eventLabel(event),
        player,
        clipMeta(event, false, team),
        note ? `note from your coach: ${note}` : null,
        active ? "playing" : watched ? "watched" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPlay}
      onLayout={onLayout}
      className={rowClass(active)}
    >
      <RowBody
        tile={<PlayTile code={eventShortLabel(event)} color={colors.eventDot[eventHue(event)]} watched={watched} playing={active} />}
        title={title}
        meta={clipMeta(event, !!player, team)}
        note={!!note}
        drawings={drawings}
        active={active}
        watched={watched}
      />
    </Tappable>
  );
}

/**
 * A text card's row, built like a clip's so the list reads as one: a stats
 * card names its player, then the numbers and where ("13.3 PTS · 4.7 REB ·
 * Season averages"); a plain card shows its words, then how long it shows.
 */
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
  const row = cardRowSummary(card);
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={row.label}
      onPress={onPlay}
      onLayout={onLayout}
      className={rowClass(active)}
    >
      <RowBody
        tile={
          <PlayTile
            color={null}
            playing={active}
            glyph={<Icon name={row.kind === "stats" ? "stats" : "textCard"} size={19} strokeWidth={2.25} color={colors.foreground} />}
          />
        }
        title={row.title}
        titleLines={row.kind === "text" ? 2 : 1}
        meta={row.meta}
        note={row.hasNote}
        active={active}
      />
    </Tappable>
  );
}

/** A small heading over a run of clips from one game, in multi-game playlists. */
export function WatchGroupHeader({ title, count }: { title: string; count: number }) {
  return (
    <View accessibilityRole="header" className="flex-row items-baseline justify-between gap-3 px-4 pb-1 pt-5">
      <Text variant="footnote" numberOfLines={2} className="shrink font-semibold text-muted-foreground">
        {title}
      </Text>
      <Text variant="footnote" nums className="shrink-0 text-muted-foreground">
        {count} {count === 1 ? "clip" : "clips"}
      </Text>
    </View>
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

/** The pill itself: a neutral fill, as the desktop marks the play on screen (colour is for controls). */
export function ActivePill({ style }: { style: ReturnType<typeof useActivePill>["style"] }) {
  const colors = useThemeColors();
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: 8, right: 8, top: 0, borderRadius: 14, backgroundColor: colors.fill2 }, style]}
    />
  );
}
