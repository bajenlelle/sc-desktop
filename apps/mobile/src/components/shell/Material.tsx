import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useReduceTransparency } from "@/lib/a11y";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

/**
 * The translucent material behind floating chrome (the tab bar, the title
 * bar once content scrolls under it), as the web's `bg-material-toolbar
 * backdrop-blur-xl`: a blur with the page colour at 72% over it. iOS only:
 * Android draws its bars solid (Material's own idiom, and expo-blur there
 * would re-render a blur target on every scroll frame), and so does iOS under
 * Reduce Transparency.
 */
export function Material({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const reduceTransparency = useReduceTransparency();
  const solid = Platform.OS !== "ios" || reduceTransparency;
  return (
    <View style={style}>
      {solid ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
      ) : (
        <>
          <BlurView intensity={40} tint={resolvedMode} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.materialToolbar }]} />
        </>
      )}
      {children}
    </View>
  );
}

/** Whether materials are drawn solid on this device (Android, Reduce Transparency). */
export function useSolidMaterial(): boolean {
  const reduceTransparency = useReduceTransparency();
  return Platform.OS !== "ios" || reduceTransparency;
}
