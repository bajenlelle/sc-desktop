import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeOutDown, LinearTransition, SlideInDown } from "react-native-reanimated";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { TAB_BAR_H } from "@/lib/layout";
import { useThemeColors } from "@/lib/theme-context";

type Tone = "success" | "neutral" | "warning";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<{ show: (message: string, opts?: { tone?: Tone }) => void } | null>(null);

const ICON: Record<Tone, IconName> = { success: "checkCircle", neutral: "info", warning: "warning" };

/**
 * A short confirmation at the bottom of the screen, above the tab bar, as the
 * web's toasts (sonner): the popover surface, a soft shadow, gone after 4 s.
 * Screen readers hear it. Mounted in app/(app)/_layout.tsx.
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const show = useCallback((message: string, opts?: { tone?: Tone }) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone: opts?.tone ?? "success" });
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const ctx = useMemo(() => ({ show }), [show]);
  const tint = toast?.tone === "warning" ? colors.warning : toast?.tone === "neutral" ? colors.mutedForeground : colors.success;

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: "flex-end", alignItems: "center" }]}>
        {toast && (
          <Animated.View
            key={toast.id}
            entering={SlideInDown.springify().damping(52.76).stiffness(696)}
            exiting={FadeOutDown.duration(150)}
            layout={LinearTransition}
            accessibilityLiveRegion="polite"
            style={[
              styles.toast,
              {
                marginBottom: insets.bottom + TAB_BAR_H + 12,
                backgroundColor: colors.popover,
                borderColor: colors.separator,
              },
            ]}
          >
            <Icon name={ICON[toast.tone]} size={18} strokeWidth={2} color={tint} />
            <Text className="shrink">{toast.message}</Text>
          </Animated.View>
        )}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastHost");
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    maxWidth: 360,
    marginHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "black",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
