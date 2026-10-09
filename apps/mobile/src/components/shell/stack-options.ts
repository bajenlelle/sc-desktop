import { Platform } from "react-native";
import type { NativeStackNavigationOptions } from "expo-router/native-stack";
import { useThemeColors } from "@/lib/theme-context";

const IOS_MAJOR = Platform.OS === "ios" ? parseInt(String(Platform.Version), 10) : 0;

/**
 * A tab's native navigation bar, as the web's phone toolbar imitates it: on
 * iOS a large title that collapses into the bar as the list scrolls under it,
 * the bar transparent at rest and frosted once content passes beneath (the
 * system's own scroll-edge effect from iOS 26; a blur material before that).
 * Android gets its standard top app bar in the theme's colours. Screens using
 * it put a ScrollView/FlatList at their root with
 * contentInsetAdjustmentBehavior="automatic".
 */
export function useTabStackOptions(): NativeStackNavigationOptions {
  const colors = useThemeColors();
  return {
    headerLargeTitleEnabled: true,
    headerTransparent: Platform.OS === "ios",
    headerBlurEffect: Platform.OS === "ios" && IOS_MAJOR < 26 ? "systemChromeMaterial" : undefined,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.foreground },
    headerLargeTitleStyle: { color: colors.foreground },
    headerStyle: Platform.OS === "android" ? { backgroundColor: colors.background } : undefined,
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: colors.background },
  };
}
