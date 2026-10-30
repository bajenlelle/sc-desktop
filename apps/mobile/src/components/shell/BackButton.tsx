import { Text as RNText } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { pressScale } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { interStyle } from "@/lib/fonts";

/**
 * The title bar's back button, as iOS draws it: a chevron and the previous
 * screen's name in the primary colour. Android's hardware back does the same.
 */
export function BackButton({ label, onPress }: { label?: string; onPress?: () => void }) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={pressScale.control}
      accessibilityRole="button"
      accessibilityLabel={label ? `Back to ${label}` : "Back"}
      hitSlop={6}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))}
      style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 1, marginLeft: -6, paddingRight: 6 }}
    >
      <Icon name="chevronLeft" size={26} strokeWidth={2} color={colors.primary} />
      {label ? (
        <RNText maxFontSizeMultiplier={1.3} numberOfLines={1} style={[{ fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: colors.primary }, interStyle(400)]}>
          {label}
        </RNText>
      ) : null}
    </Tappable>
  );
}
