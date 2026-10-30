import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { BlurView } from "expo-blur";
import { useSolidMaterial } from "@/components/shell/Material";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { pressScale } from "@/lib/motion";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

export const GLASS_BUTTON = 44;

/**
 * A round button floating over content, as Claude's bar draws its menu and
 * filter buttons: a blurred disc with a quiet fill and a hairline on iOS; the
 * fill alone on Android and under Reduce Transparency (as every material
 * here). Holds one icon; `badge` adds a small primary dot at its corner.
 */
export function GlassButton({
  onPress,
  accessibilityLabel,
  badge = false,
  disabled = false,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  badge?: boolean;
  /** Dimmed and inert (a save button with nothing to save). */
  disabled?: boolean;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const solid = useSolidMaterial();
  return (
    <Tappable
      scaleTo={pressScale.control}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={{ width: GLASS_BUTTON, height: GLASS_BUTTON, opacity: disabled ? 0.45 : 1 }}
    >
      <View
        style={[
          styles.disc,
          { borderColor: colors.separator, backgroundColor: solid ? colors.background : "transparent" },
        ]}
      >
        {solid ? null : <BlurView intensity={30} tint={resolvedMode} style={StyleSheet.absoluteFill} />}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.fill2 }]} />
        {children}
      </View>
      {badge ? (
        <View
          accessible={false}
          style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.background }]}
        />
      ) : null}
    </Tappable>
  );
}

/**
 * Puts the settings sheet away (its root page's leading button, as Claude's
 * and iOS's own sheets draw it). A cold deep link opens the sheet as the
 * stack's only screen; then it goes to the playlists instead.
 */
export function CloseButton() {
  const colors = useThemeColors();
  return (
    <GlassButton
      accessibilityLabel="Close"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/playlists"))}
    >
      <Icon name="close" size={20} color={colors.foreground} />
    </GlassButton>
  );
}

/** Back to the previous page inside the sheet; it never closes the sheet. */
export function SheetBackButton() {
  const colors = useThemeColors();
  return (
    <GlassButton accessibilityLabel="Back" onPress={() => router.back()}>
      <Icon name="chevronLeft" size={22} color={colors.foreground} />
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: GLASS_BUTTON,
    height: GLASS_BUTTON,
    borderRadius: GLASS_BUTTON / 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { position: "absolute", top: 1, right: 1, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
});
