import type { RefObject } from "react";
import { View } from "react-native";
import { GlassButton } from "@/components/shell/GlassButton";
import { Icon } from "@/components/ui/Icon";
import { useThemeColors } from "@/lib/theme-context";

/**
 * The one way into a list's filters and sort: a glass button at the bar's
 * right end whose icon turns the primary colour while any filter is on. The
 * pop-up menu opens from it (`anchorRef`).
 */
export function FilterButton({
  activeCount,
  onPress,
  anchorRef,
}: {
  activeCount: number;
  onPress: () => void;
  anchorRef?: RefObject<View | null>;
}) {
  const colors = useThemeColors();
  return (
    <View ref={anchorRef} collapsable={false}>
      <GlassButton onPress={onPress} accessibilityLabel={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}>
        <Icon name="sliders" size={20} color={activeCount > 0 ? colors.primary : colors.foreground} />
      </GlassButton>
    </View>
  );
}
