/**
 * The player's controls, white on the footage (the web's transport-bar.tsx):
 * a translucent dark material, the control button in its three sizes, the
 * speed menu and the full-screen button.
 */
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { MenuView } from "@expo/ui/community/menu";
import { PLAYBACK_SPEEDS } from "@/hooks/use-clip-queue";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useReduceTransparency } from "@/lib/a11y";
import { selectionHaptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/** White at the web's text-white/85: controls a step quieter than the footage's text. */
export const CONTROL_WHITE = "rgba(255,255,255,0.85)";

/**
 * Dark glass behind floating controls: blur plus a black wash on iOS, as the
 * web's bg-black/55 backdrop-blur-xl. Solid where blur isn't wanted (Reduce
 * Transparency) or isn't the platform's idiom (Android).
 */
export function PlayerMaterial({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduceTransparency = useReduceTransparency();
  if (Platform.OS !== "ios" || reduceTransparency) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.78)" }, style]} />;
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <BlurView tint="dark" intensity={30} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }]} />
    </View>
  );
}

/**
 * md: in the bar (44 pt); lg: play/pause in the bar; xl: the round centre
 * button of the phone layout. Feedback on press-in, as on the web.
 */
export function ControlButton({
  label,
  icon,
  onPress,
  disabled,
  size = "md",
  iconSize,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  size?: "md" | "lg" | "xl";
  iconSize?: number;
}) {
  const glyph = iconSize ?? (size === "xl" ? 28 : size === "lg" ? 26 : 20);
  return (
    <Tappable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.9}
      className={({ pressed }) =>
        cn(
          "items-center justify-center",
          size === "xl" ? "h-14 w-14 overflow-hidden rounded-full" : size === "lg" ? "h-12 w-12 rounded-lg" : "h-11 w-11 rounded-lg",
          pressed && size !== "xl" && "bg-white/20",
          disabled && "opacity-30",
        )
      }
    >
      {({ pressed }) => (
        <>
          {size === "xl" && <PlayerMaterial style={pressed ? { opacity: 0.8 } : undefined} />}
          <Icon name={icon} size={glyph} color={size === "xl" ? "#ffffff" : CONTROL_WHITE} />
        </>
      )}
    </Tappable>
  );
}

export function PlayPauseButton({ paused, onPress, size }: { paused: boolean; onPress: () => void; size: "lg" | "xl" }) {
  return <ControlButton label={paused ? "Play" : "Pause"} icon={paused ? "play" : "pause"} onPress={onPress} size={size} />;
}

export function FullscreenButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <ControlButton
      label={active ? "Exit full screen" : "Full screen"}
      icon={active ? "exitFullscreen" : "enterFullscreen"}
      onPress={onToggle}
      iconSize={18}
    />
  );
}

/** The current rate, tinted when it isn't 1×, opening the platform's menu of rates. */
export function SpeedMenu({ speed, onSpeedChange }: { speed: number; onSpeedChange: (speed: number) => void }) {
  const colors = useThemeColors();
  return (
    <MenuView
      title="Playback speed"
      colorScheme="dark"
      actions={PLAYBACK_SPEEDS.map((s) => ({ id: String(s), title: `${s}×`, state: s === speed ? "on" : "off" }))}
      onPressAction={({ nativeEvent }) => {
        const next = Number(nativeEvent.event);
        if (next !== speed) {
          selectionHaptic();
          onSpeedChange(next);
        }
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Playback speed, ${speed}×`}
        className="h-11 min-w-11 items-center justify-center rounded-lg px-2"
      >
        <Text
          variant="footnote"
          nums
          maxFontSizeMultiplier={1.4}
          className="font-semibold"
          style={{ color: speed !== 1 ? colors.primary : CONTROL_WHITE }}
        >
          {speed}×
        </Text>
      </View>
    </MenuView>
  );
}

/** Children stacked in a row with the bar's spacing. */
export function ControlRow({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={cn("flex-row items-center gap-0.5", className)}>{children}</View>;
}
