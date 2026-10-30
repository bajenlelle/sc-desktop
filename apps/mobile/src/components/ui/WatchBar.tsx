import { View } from "react-native";
import { useThemeColors } from "@/lib/theme-context";

/**
 * How far a group got through something, on one track: the solid part has
 * finished, the lighter part has started. The web's and desktop's WatchBar
 * (Shared by me), at the phone's 4 pt. Decorative: the text next to it says
 * the same in words.
 */
export function WatchBar({ done, started, total, className }: { done: number; started: number; total: number; className?: string }) {
  const colors = useThemeColors();
  const pct = (n: number) => `${total > 0 ? Math.min(100, Math.max(0, (n / total) * 100)) : 0}%` as const;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className={className}
      style={{ height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: colors.fill3 }}
    >
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(started), backgroundColor: colors.primary, opacity: 0.35 }} />
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(done), backgroundColor: colors.primary }} />
    </View>
  );
}
