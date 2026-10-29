import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { Icon } from "@/components/ui/Icon";
import { springs } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * How much of a playlist is watched, as the web's 18 pt ring: a recessed
 * track, the arc from 12 o'clock clockwise in the accent (springing to new
 * values), and a filled disc with a check once everything is watched.
 */
export function ProgressRing({ value, size = 18, stroke = 2 }: { value: number; size?: number; stroke?: number }) {
  const colors = useThemeColors();
  const v = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useSharedValue(v);
  useEffect(() => {
    progress.value = withSpring(v, springs.standard);
  }, [v, progress]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));

  if (v >= 1) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary }}
        className="items-center justify-center"
      >
        <Icon name="check" size={size * 0.62} weight="bold" color={colors.primaryForeground} />
      </View>
    );
  }
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.fill3} strokeWidth={stroke} fill="none" />
      {v > 0 && (
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arc}
        />
      )}
    </Svg>
  );
}
