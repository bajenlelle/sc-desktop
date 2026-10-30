import type { NativeStackNavigationOptions } from "expo-router/native-stack";
import { useThemeColors } from "@/lib/theme-context";

/**
 * A tab's stack: no native header. Every screen draws the app's own title
 * bar (components/shell/Screen), the same on iOS and Android, as the web's
 * phone layout does. The stack keeps the native push and the back gestures.
 */
export function useTabStackOptions(): NativeStackNavigationOptions {
  const colors = useThemeColors();
  return {
    headerShown: false,
    contentStyle: { backgroundColor: colors.background },
  };
}
