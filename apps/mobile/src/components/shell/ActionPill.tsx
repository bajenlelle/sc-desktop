import { StyleSheet } from "react-native";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { pressScale } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";

/**
 * The screen's one next step as a floating pill, where Claude puts "New
 * chat" and Cowork "New task": inverted (the text colour as its fill, the
 * page colour as its text), so it reads as the action without the accent.
 * Sits at the right above the search capsule (Screen's `bottom` slot).
 */
export function ActionPill({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={pressScale.button}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={[styles.pill, { backgroundColor: colors.foreground }]}
      className="flex-row items-center gap-2 self-end px-5"
    >
      <Icon name={icon} size={16} color={colors.background} />
      <Text maxFontSizeMultiplier={1.4} className="font-semibold" style={{ color: colors.background }}>
        {label}
      </Text>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 48,
    borderRadius: 24,
    shadowColor: "black",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
