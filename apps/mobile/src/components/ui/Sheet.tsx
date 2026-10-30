import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Text } from "@/components/ui/Text";
import { springs, timing } from "@/lib/motion";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

/**
 * Sheets render here, above the stack and the sidebar, instead of inside the
 * screen that opens them: an in-tree host rather than RN's <Modal>, so they
 * keep the theme variables. Mounted in the root layout inside the theme
 * provider, so signed-out screens can open sheets too. A sheet's content
 * sees the providers above the host (theme, auth, safe area), not the
 * screen's: pass it what it needs as props.
 */
const HostContext = createContext<{ mount: (id: string, node: ReactNode | null) => void } | null>(null);

export function SheetHost({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Record<string, ReactNode>>({});
  const mount = useCallback((id: string, node: ReactNode | null) => {
    setNodes((prev) => {
      if (node == null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: node };
    });
  }, []);
  const ctx = useMemo(() => ({ mount }), [mount]);
  return (
    <HostContext.Provider value={ctx}>
      {children}
      {Object.entries(nodes).map(([id, node]) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </HostContext.Provider>
  );
}

/** The host's mount API, for other overlays that render above everything (the pop-up menu). */
export function usePortal() {
  return useContext(HostContext);
}

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Right of the title: a text action (Reset, Done). */
  trailing?: ReactNode;
  /** Dark in both modes, in the user's dark theme (menus over the player). */
  appearance?: "dark";
  accessibilityLabel?: string;
  children: ReactNode;
}

/**
 * The web's phone dialog: a bottom sheet with a grabber that rises on the
 * gentle spring, follows a drag 1:1, and closes past 160 pt or a fling of
 * 600 pt/s (else settles back). The scrim, Android's back button and a drag
 * all close it. Declarative: render it where its state lives.
 */
export function Sheet(props: SheetProps) {
  const host = useContext(HostContext);
  const id = useId();
  const [mounted, setMounted] = useState(props.visible);
  useEffect(() => {
    if (!props.visible) return;
    setMounted(true);
    // A sheet opened from a list while searching would rise under the
    // keyboard: put the keyboard away first (no sheet here takes text).
    Keyboard.dismiss();
  }, [props.visible]);
  const panel = mounted ? <SheetPanel {...props} onExited={() => setMounted(false)} /> : null;
  if (__DEV__ && !host) console.warn("Sheet rendered outside SheetHost: it can't open.");
  useLayoutEffect(() => {
    host?.mount(id, panel);
  });
  useEffect(() => () => host?.mount(id, null), [host, id]);
  return null;
}

function SheetPanel({
  visible,
  onClose,
  onExited,
  title,
  trailing,
  appearance,
  accessibilityLabel,
  children,
}: SheetProps & { onExited: () => void }) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const theme = useAppTheme();
  const lightColors = useThemeColors();
  const colors = appearance === "dark" ? theme.darkColors : lightColors;
  const translateY = useSharedValue(screenHeight);
  const scrim = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, springs.gentle);
      scrim.value = withTiming(1, { duration: timing.scrimIn });
    } else {
      scrim.value = withTiming(0, { duration: timing.scrimOut });
      translateY.value = withSpring(screenHeight, springs.exit, (finished) => {
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

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Down follows the finger; up gives a little, as a rubber band.
      translateY.value = e.translationY > 0 ? e.translationY : e.translationY * 0.2;
    })
    .onEnd((e) => {
      if (e.translationY > 160 || e.velocityY > 600) runOnJS(onClose)();
      else translateY.value = withSpring(0, springs.settle);
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel={accessibilityLabel ?? title}
        style={[
          styles.panel,
          appearance === "dark" ? theme.darkVarsStyle : null,
          {
            backgroundColor: colors.popover,
            maxHeight: screenHeight - insets.top - 40,
            paddingBottom: insets.bottom + 12,
          },
          panelStyle,
        ]}
      >
        <GestureDetector gesture={pan}>
          <View>
            <View style={styles.grabberZone}>
              <View style={[styles.grabber, { backgroundColor: colors.fill4 }]} />
            </View>
            {title || trailing ? (
              <View className="min-h-11 flex-row items-center justify-between gap-3 px-4">
                {title ? (
                  <Text variant="title3" accessibilityRole="header" numberOfLines={1} className="shrink" style={{ color: colors.foreground }}>
                    {title}
                  </Text>
                ) : (
                  <View />
                )}
                {trailing}
              </View>
            ) : null}
          </View>
        </GestureDetector>
        {/* Always able to scroll: content that fits doesn't move, and content
            taller than the screen (a menu in landscape) stays reachable. */}
        <ScrollView bounces={false} alwaysBounceVertical={false} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.4)" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    shadowColor: "black",
    shadowOpacity: 0.3,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  grabberZone: { height: 22, alignItems: "center", paddingTop: 6 },
  grabber: { width: 36, height: 5, borderRadius: 3 },
});
