import { useEffect, useId, useLayoutEffect, useState, type RefObject } from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { useSolidMaterial } from "@/components/shell/Material";
import { useLargeText } from "@/lib/a11y";
import { Icon, type IconName } from "@/components/ui/Icon";
import { usePortal } from "@/components/ui/Sheet";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { selectionHaptic } from "@/lib/haptics";
import { springs, timing } from "@/lib/motion";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

export interface PopoverItem {
  key: string;
  label: string;
  icon?: IconName;
  /** The current choice in its group: a check in front. */
  checked?: boolean;
  /** A muted figure at the end (how many a filter leaves). */
  count?: number;
  destructive?: boolean;
  onSelect: () => void;
}

/** Items that belong together; groups are split by a hairline. */
export interface PopoverGroup {
  key: string;
  items: PopoverItem[];
}

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RADIUS = 14;
const MIN_WIDTH = 250;

/**
 * A menu that opens from the control that asked for it, as Claude's filter
 * and sort menus: a floating panel by the button, groups split by hairlines,
 * a check in front of each group's current choice, an icon and a label per
 * row, a muted count at the end. It grows out of the button's corner and
 * closes on a choice, a tap outside or Android back. Blurred on iOS, solid
 * on Android and under Reduce Transparency, the same everywhere else.
 * Renders through the sheet host, above every screen. `appearance="dark"`
 * draws it dark in either mode (over the player).
 */
export function PopoverMenu({
  visible,
  onClose,
  anchorRef,
  groups,
  appearance,
  accessibilityLabel,
}: {
  visible: boolean;
  onClose: () => void;
  /** The control it opens from (a View, measured when it opens). */
  anchorRef: RefObject<View | null>;
  groups: PopoverGroup[];
  appearance?: "dark";
  accessibilityLabel?: string;
}) {
  const portal = usePortal();
  const id = useId();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // The menu is a choice, not typing: the keyboard goes before it opens.
    Keyboard.dismiss();
    const node = anchorRef.current;
    if (!node) {
      onClose();
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setFrame({ x, y, width, height });
      setMounted(true);
    });
    // Measure once per opening; the anchor doesn't move while the menu is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (__DEV__ && !portal) console.warn("PopoverMenu rendered outside SheetHost: it can't open.");
  const panel =
    mounted && frame ? (
      <PopoverPanel
        visible={visible}
        frame={frame}
        groups={groups}
        appearance={appearance}
        accessibilityLabel={accessibilityLabel}
        onClose={onClose}
        onExited={() => setMounted(false)}
      />
    ) : null;
  useLayoutEffect(() => {
    portal?.mount(id, panel);
  });
  useEffect(() => () => portal?.mount(id, null), [portal, id]);
  return null;
}

function PopoverPanel({
  visible,
  frame,
  groups,
  appearance,
  accessibilityLabel,
  onClose,
  onExited,
}: {
  visible: boolean;
  frame: Frame;
  groups: PopoverGroup[];
  appearance?: "dark";
  accessibilityLabel?: string;
  onClose: () => void;
  onExited: () => void;
}) {
  const theme = useAppTheme();
  const lightColors = useThemeColors();
  const dark = appearance === "dark";
  const colors = dark ? theme.darkColors : lightColors;
  const solid = useSolidMaterial();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  // At large text sizes the panel takes its full width: labels wrap instead
  // of being measured on one line and clipped (Android).
  const large = useLargeText();
  const maxWidth = Math.min(340, W - 24);

  // Under the button when there's room, else above it; on the button's side.
  const spaceBelow = H - (frame.y + frame.height) - insets.bottom - 12;
  const spaceAbove = frame.y - insets.top - 12;
  const below = spaceBelow >= 240 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(132, (below ? spaceBelow : spaceAbove) - 8);
  const fromLeft = frame.x + frame.width / 2 < W / 2;
  const place = {
    ...(fromLeft ? { left: Math.max(12, frame.x) } : { right: Math.max(12, W - (frame.x + frame.width)) }),
    ...(below ? { top: frame.y + frame.height + 8 } : { bottom: H - frame.y + 8 }),
  };
  const origin = `${below ? "top" : "bottom"} ${fromLeft ? "left" : "right"}`;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = withSpring(1, springs.standard);
    } else {
      progress.value = withTiming(0, { duration: timing.fadeOut }, (finished) => {
        if (finished) runOnJS(onExited)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.9, 1]) }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" accessibilityRole="button" />
      <Animated.View
        accessibilityViewIsModal
        accessibilityRole="menu"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.panel,
          place,
          { transformOrigin: origin, maxWidth, ...(large ? { width: maxWidth } : null), shadowOpacity: dark || theme.resolvedMode === "dark" ? 0.5 : 0.16 },
          dark ? theme.darkVarsStyle : null,
          panelStyle,
        ]}
      >
        <View style={[styles.surface, { borderColor: colors.separator }]}>
          {solid ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.popover }]} />
          ) : (
            <>
              <BlurView intensity={60} tint={dark ? "dark" : theme.resolvedMode} style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.materialPopover }]} />
            </>
          )}
          <ScrollView style={{ maxHeight }} bounces={false} showsVerticalScrollIndicator={false}>
            <View className="py-1">
              {groups.map((g, gi) => (
                <View key={g.key}>
                  {gi > 0 ? <View style={[styles.divider, { backgroundColor: colors.separator }]} /> : null}
                  {g.items.map((item) => (
                    <Tappable
                      key={item.key}
                      scaleTo={1}
                      accessibilityRole="menuitem"
                      accessibilityState={{ checked: !!item.checked }}
                      accessibilityLabel={item.count != null ? `${item.label}, ${item.count}` : item.label}
                      onPress={() => {
                        if (!item.checked) selectionHaptic();
                        item.onSelect();
                        onClose();
                      }}
                      className={({ pressed }) => cn("min-h-11 flex-row items-center gap-3 py-2 pl-3 pr-4", pressed && "bg-fill-2")}
                    >
                      <View style={styles.check}>
                        {item.checked ? <Icon name="check" size={16} strokeWidth={2.5} color={colors.foreground} /> : null}
                      </View>
                      {item.icon ? (
                        <Icon name={item.icon} size={18} color={item.destructive ? colors.destructive : colors.foreground} />
                      ) : null}
                      {/* The panel takes its rows' width (up to its max), so a label only wraps when it must. */}
                      <Text numberOfLines={2} style={{ flexShrink: 1, color: item.destructive ? colors.destructive : colors.foreground }}>
                        {item.label}
                      </Text>
                      <View style={styles.spacer} />
                      {item.count != null ? (
                        <Text variant="subheadline" nums style={{ color: colors.mutedForeground }}>
                          {String(item.count)}
                        </Text>
                      ) : null}
                    </Tappable>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    minWidth: MIN_WIDTH,
    borderRadius: RADIUS,
    shadowColor: "black",
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  surface: { borderRadius: RADIUS, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  check: { width: 18, alignItems: "center" },
  spacer: { flex: 1, minWidth: 12 },
});
