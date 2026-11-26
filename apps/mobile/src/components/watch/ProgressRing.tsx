import Svg, { Circle } from "react-native-svg";
import { useThemeColors } from "@/lib/theme-context";

/** How much of a playlist is watched, as a ring filling up (Things' project pie). Decorative: the words say it too. */
export function ProgressRing({ value, size = 28, stroke = 3 }: { value: number; size?: number; stroke?: number }) {
  const colors = useThemeColors();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }} accessible={false}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.fill3} strokeWidth={stroke} fill="none" />
      {v > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.04, v) * c} ${c}`}
        />
      ) : null}
    </Svg>
  );
}
