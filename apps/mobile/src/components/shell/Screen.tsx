import type { ReactNode } from "react";
import { Platform, RefreshControl, StyleSheet, View, type LayoutChangeEvent } from "react-native";
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
import { useShell } from "@/components/shell/ShellContext";
import { Text } from "@/components/ui/Text";
import { CONTENT_BOTTOM, TOOLBAR_ROW_H } from "@/lib/layout";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/lib/theme-context";

/** The bar's fade below its material, standing in for the web's mask-image edge. */
const EDGE_FADE = 10;

export interface ScreenProps {
  title: string;
  /**
   * A large title at the top of the content that hands over to the bar's
   * small title as it scrolls under the bar (tab roots). Off, the small
   * title shows from the start (detail screens).
   */
  large?: boolean;
  /** Left of the bar: a BackButton on detail screens. */
  leading?: ReactNode;
  /** Right of the bar: icon actions (the filter button). */
  trailing?: ReactNode;
  /** Under the large title: the screen's view switcher. */
  principal?: ReactNode;
  /** Under the switcher: a search field. */
  search?: ReactNode;
  /** Settings-style screens sit on the grouped floor (`canvas`). */
  grouped?: boolean;
  /** false for fixed layouts (the watch view): no scroll view, a solid bar. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Classes for the content under the title block. */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * A screen in the app's own chrome, as the web's phone toolbar draws it: a
 * 44 pt bar under the status bar with a back button or actions, and a large
 * title at the top of the content that scrolls away while the bar's small
 * title fades in. The bar is clear at rest and takes the material once
 * content passes under it. The content pads for the bar, the tab bar and the
 * home indicator, so it scrolls under both.
 */
export function Screen({
  title,
  large = false,
  leading,
  trailing,
  search,
  principal,
  grouped = false,
  scroll = true,
  refreshing,
  onRefresh,
  contentClassName,
  children,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { tabBarHeight } = useShell();
  const colors = useThemeColors();
  const solid = useSolidMaterial();
  const barHeight = insets.top + TOOLBAR_ROW_H;
  // iOS insets the scroll view so the pull-to-refresh spinner shows under
  // the bar; Android pads the content instead. scrollY is the same on both:
  // 0 with the content at rest under the bar.
  const iosInset = Platform.OS === "ios" ? barHeight : 0;

  const scrollY = useSharedValue(0);
  // Where the large title ends, in scroll offset: the title block's place in
  // the content plus the title's bottom inside the block, less Android's
  // top padding (iOS insets instead).
  const blockY = useSharedValue(0);
  const titleBottom = useSharedValue(large ? 1e6 : 0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y + iosInset;
  });

  const materialStyle = useAnimatedStyle(() => ({
    opacity: scroll ? interpolate(scrollY.value, [0, 10], [0, 1], Extrapolation.CLAMP) : 1,
  }));
  const smallTitleStyle = useAnimatedStyle(() => {
    const end = blockY.value + titleBottom.value - (Platform.OS === "ios" ? 0 : barHeight);
    return { opacity: large ? interpolate(scrollY.value, [end - 6, end + 6], [0, 1], Extrapolation.CLAMP) : 1 };
  });

  const onBlockLayout = (e: LayoutChangeEvent) => {
    blockY.value = e.nativeEvent.layout.y;
  };
  const onTitleLayout = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    titleBottom.value = y + height;
  };

  const floor = grouped ? colors.canvas : colors.background;
  const bottomPad = (tabBarHeight > 0 ? tabBarHeight : insets.bottom) + CONTENT_BOTTOM;

  const titleBlock = large ? (
    <View className="px-4 pb-2.5 pt-0.5" onLayout={onBlockLayout}>
      <View onLayout={onTitleLayout}>
        <Text variant="largeTitle" accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
      </View>
      {principal ? <View className="mt-3">{principal}</View> : null}
      {search ? <View className={principal ? "mt-2.5" : "mt-1.5"}>{search}</View> : null}
    </View>
  ) : search || principal ? (
    <View className="gap-2.5 px-4 pb-2.5 pt-1">
      {principal}
      {search}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: floor }}>
      {scroll ? (
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          contentInset={Platform.OS === "ios" ? { top: barHeight } : undefined}
          contentOffset={Platform.OS === "ios" ? { x: 0, y: -barHeight } : undefined}
          scrollIndicatorInsets={Platform.OS === "ios" ? { top: barHeight, bottom: tabBarHeight } : undefined}
          contentContainerStyle={{ paddingTop: Platform.OS === "ios" ? 0 : barHeight, paddingBottom: bottomPad }}
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

      {/* The bar floats over the content. */}
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
        <View pointerEvents="box-none" style={[styles.row, { marginTop: insets.top }]}>
          <View pointerEvents="box-none" style={styles.side}>
            {leading}
          </View>
          <Animated.View pointerEvents="none" style={[styles.titleSlot, smallTitleStyle]}>
            <Text variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.3} accessible={!large}>
              {title}
            </Text>
          </Animated.View>
          <View pointerEvents="box-none" style={[styles.side, styles.trailing]}>
            {trailing}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, top: 0 },
  row: { height: TOOLBAR_ROW_H, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  side: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center" },
  trailing: { justifyContent: "flex-end", gap: 4, marginRight: -10 },
  titleSlot: { maxWidth: "55%", alignItems: "center" },
  hairline: { position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  fade: { position: "absolute", left: 0, right: 0, bottom: -EDGE_FADE },
});
