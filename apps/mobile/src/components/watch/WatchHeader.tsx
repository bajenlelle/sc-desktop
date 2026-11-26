/**
 * The top of the watch list (and of a scouting report), as a music app opens a playlist: a wash of the
 * team's colour fading into the page, who sent it, the name big in the
 * display face, one quiet line, then how much is watched (a ring and the
 * count) and the screen's one filled button, Play, Resume or Pause. It
 * scrolls away under the player; the bar's small title takes over.
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Avatar } from "@/components/Avatar";
import { useLargeText } from "@/lib/a11y";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { displayStyle } from "@/lib/fonts";
import { selectionHaptic } from "@/lib/haptics";
import { pressScale } from "@/lib/motion";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { ProgressRing } from "./ProgressRing";

const PLAY = 56;

/** How strong the team's wash starts at the header's top, per mode (a bar over it can match: Screen's barWash). */
export function washAlpha(mode: "light" | "dark"): number {
  return mode === "dark" ? 0.34 : 0.2;
}

export type HeaderAction = "play" | "resume" | "pause";

const ACTION_LABEL: Record<HeaderAction, string> = { play: "Play", resume: "Resume", pause: "Pause" };

export function WatchHeader({
  color,
  sharerName,
  sharerAvatarUrl,
  source,
  title,
  meta,
  watched,
  total,
  action,
  onAction,
  onTitleLayout,
  top,
  children,
}: {
  /** The team's colour (hex) for the wash. */
  color: string;
  sharerName?: string | null;
  sharerAvatarUrl?: string | null;
  /** The team it came through ("Basketettan Dam"). */
  source?: string | null;
  title: string;
  meta: string;
  watched: number;
  total: number;
  /** null when there is nothing to play. */
  action: HeaderAction | null;
  onAction: () => void;
  /** Where the big title ends, in the header's own space: the bar's title comes in past it. */
  onTitleLayout?: (bottom: number) => void;
  /** Replaces the sender line over the title (the report's kicker and game time). */
  top?: ReactNode;
  /** Under the meta line, before the progress row (the report's summary). */
  children?: ReactNode;
}) {
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const large = useLargeText();
  const who = [sharerName, source].filter(Boolean).join(" · ");
  return (
    <View className="px-4 pb-3 pt-4">
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 10 10" pointerEvents="none">
        <Defs>
          <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={washAlpha(resolvedMode)} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="10" height="10" fill="url(#wash)" />
      </Svg>

      {top ?? (who ? (
        <View className="flex-row items-center gap-2">
          {sharerName ? <Avatar name={sharerName} url={sharerAvatarUrl} size={22} /> : null}
          <Text variant="footnote" numberOfLines={1} className="shrink text-muted-foreground">
            {who}
          </Text>
        </View>
      ) : null)}

      <View onLayout={(e: LayoutChangeEvent) => onTitleLayout?.(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <Text
          accessibilityRole="header"
          numberOfLines={3}
          maxFontSizeMultiplier={1.3}
          style={[displayStyle(800), { fontSize: 38, lineHeight: 38, paddingTop: 8, textTransform: "uppercase", color: colors.foreground }]}
        >
          {title}
        </Text>
      </View>
      <Text variant="footnote" nums numberOfLines={large ? 2 : 1} className="text-muted-foreground">
        {meta}
      </Text>
      {children}

      <View className="mt-3 flex-row items-center justify-between gap-3">
        {total > 0 ? (
          <View
            accessible
            accessibilityLabel={`${watched} of ${total} watched`}
            className="min-w-0 shrink flex-row items-center gap-2.5"
          >
            <ProgressRing value={watched / total} />
            <Text numberOfLines={1} className="shrink">
              <Text style={[displayStyle(800), { fontSize: 22, color: colors.foreground }]}>{watched}</Text>
              <Text variant="footnote" nums className="text-muted-foreground">
                {` / ${total} watched`}
              </Text>
            </Text>
          </View>
        ) : (
          <View />
        )}
        {action ? (
          <Tappable
            scaleTo={pressScale.button}
            accessibilityRole="button"
            accessibilityLabel={ACTION_LABEL[action]}
            onPress={() => {
              selectionHaptic();
              onAction();
            }}
            style={{
              width: PLAY,
              height: PLAY,
              borderRadius: PLAY / 2,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
              paddingLeft: action === "pause" ? 0 : 3,
            }}
          >
            <Icon name={action === "pause" ? "pause" : "play"} size={24} color={colors.primaryForeground} />
          </Tappable>
        ) : null}
      </View>
    </View>
  );
}
