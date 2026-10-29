import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { springs } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/** A rounded progress bar (value 0–1): recessed track, accent fill that springs to new values. */
export function ProgressBar({ value, className, height = 6 }: { value: number; className?: string; height?: number }) {
  const colors = useThemeColors();
  const v = Math.min(1, Math.max(0, value));
  const scale = useSharedValue(v);
  useEffect(() => {
    scale.value = withSpring(v, springs.standard);
  }, [v, scale]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));
  return (
    <View style={{ height }} className={cn("overflow-hidden rounded-full bg-fill-2", className)}>
      <Animated.View
        style={[{ height, width: "100%", borderRadius: height / 2, backgroundColor: colors.primary, transformOrigin: "left" }, fill]}
      />
    </View>
  );
}
