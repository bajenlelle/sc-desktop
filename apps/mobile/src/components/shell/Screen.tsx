import { useState, type ReactNode } from "react";
import { Platform, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Material, useSolidMaterial } from "@/components/shell/Material";
import { MenuButton } from "@/components/shell/MenuButton";
import { Text } from "@/components/ui/Text";
import { CONTENT_BOTTOM, ROOT_BAR_ROW_H, TOOLBAR_ROW_H } from "@/lib/layout";
import { useKeyboardLift } from "@/lib/use-keyboard-lift";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/lib/theme-context";

/** The bar's fade below its material, standing in for the web's mask-image edge. */
const EDGE_FADE = 10;
/** Air between a sheet's top edge and its bar row. */
const SHEET_TOP_AIR = 8;

export interface ScreenProps {
  title: string;
  /**
   * A root destination (the sidebar's): the bar opens the sidebar from its
   * left end and is a little taller, for the glass buttons.
   */
  menu?: boolean;
  /**
   * A page of the settings sheet: the glass buttons' taller row with a little
   * air above it (the sheet's top edge sits right over it), no menu button.
   */
  sheet?: boolean;
  /** Left of the bar: a BackButton on detail screens (the menu button on roots). */
  leading?: ReactNode;
  /** Right of the bar: glass buttons (the filter button). */
  trailing?: ReactNode;
  /** At the top of the content: a search field. */
  search?: ReactNode;
  /**
   * Floating at the foot of the screen, over the content and lifted with the
   * keyboard: the search capsule and the action pill.
   */
  bottom?: ReactNode;
  /** Settings-style screens sit on the grouped floor (`canvas`). */
  grouped?: boolean;
  /** false for fixed layouts (the watch view): no scroll view, a solid bar. */
  scroll?: boolean;
  /** No bar at all (the watch view's full-screen player covers the window). */
  barHidden?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Classes for the content under the title block. */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * A screen in the app's own chrome, as Claude's app draws it: a bar under the
 * status bar with a centred small title, the menu button (root screens) or a
 * back button on the left and glass buttons on the right. The bar is clear
 * at rest and takes the material once content passes under it. The content
 * pads for the bar and the home indicator, so it scrolls under both.
 */
export function Screen({
  title,
  menu = false,
  sheet = false,
  leading,
  trailing,
  search,
  bottom,
  grouped = false,
  scroll = true,
  barHidden = false,
  refreshing,
  onRefresh,
  contentClassName,
  children,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const solid = useSolidMaterial();
  const rowHeight = menu || sheet ? ROOT_BAR_ROW_H : TOOLBAR_ROW_H;
  const topAir = sheet ? SHEET_TOP_AIR : 0;
  const barHeight = barHidden ? 0 : insets.top + topAir + rowHeight;
  // The content pads for the bar on both platforms (an iOS content inset gets
  // reset by UIKit when a tab's screen remounts in the background). The bar
  // is clear at rest and while pulling, so iOS's refresh spinner shows
  // through it; Android's is offset below it.

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const [bottomHeight, setBottomHeight] = useState(0);
  const lift = useKeyboardLift();
  const bottomStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));

  const materialStyle = useAnimatedStyle(() => ({
    opacity: scroll ? interpolate(scrollY.value, [0, 10], [0, 1], Extrapolation.CLAMP) : 1,
  }));

  const floor = grouped ? colors.canvas : colors.background;
  // Content clears the floating bottom slot (or the home indicator) and ends with air.
  const bottomPad = (bottom ? bottomHeight : insets.bottom) + CONTENT_BOTTOM;

  const titleBlock = search ? <View className="px-4 pb-2.5 pt-1">{search}</View> : null;

  return (
    <View style={{ flex: 1, backgroundColor: floor }}>
      {scroll ? (
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          scrollIndicatorInsets={{ top: barHeight }}
          contentContainerStyle={{ paddingTop: barHeight, paddingBottom: bottomPad }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={colors.mutedForeground}
                progressViewOffset={Platform.OS === "android" ? barHeight : undefined}
              />
            ) : undefined
          }
        >
          {titleBlock}
          <View className={cn(contentClassName)}>{children}</View>
        </Animated.ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: barHeight }}>
          {titleBlock}
          {children}
        </View>
      )}

      {bottom ? (
        <Animated.View
          pointerEvents="box-none"
          onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}
          style={[styles.bottom, { paddingBottom: insets.bottom + 8 }, bottomStyle]}
        >
          {bottom}
        </Animated.View>
      ) : null}

      {/* The bar floats over the content. */}
      {barHidden ? null : (
      <View pointerEvents="box-none" style={[styles.bar, { height: barHeight }]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, materialStyle]}>
          {scroll ? (
            <>
              <Material style={StyleSheet.absoluteFill} />
              {solid ? (
                <View style={[styles.hairline, { backgroundColor: colors.separator }]} />
              ) : (
                <Svg style={styles.fade} width="100%" height={EDGE_FADE}>
                  <Defs>
                    <LinearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={colors.background} stopOpacity={0.72} />
                      <Stop offset="1" stopColor={colors.background} stopOpacity={0} />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height={EDGE_FADE} fill="url(#edge)" />
                </Svg>
              )}
            </>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: floor }]} />
          )}
        </Animated.View>
        <View pointerEvents="box-none" style={[styles.row, { height: rowHeight, marginTop: insets.top + topAir }]}>
          <View pointerEvents="box-none" style={styles.side}>
            {leading ?? (menu ? <MenuButton /> : null)}
          </View>
          <View pointerEvents="none" style={styles.titleSlot}>
            <Text variant="headline" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {title}
            </Text>
          </View>
          <View pointerEvents="box-none" style={[styles.side, styles.trailing]}>
            {trailing}
          </View>
        </View>
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, top: 0 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  side: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center" },
  trailing: { justifyContent: "flex-end", gap: 8 },
  titleSlot: { maxWidth: "55%", alignItems: "center" },
  hairline: { position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  fade: { position: "absolute", left: 0, right: 0, bottom: -EDGE_FADE },
});
