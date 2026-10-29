import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { pressScale } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";

/**
 * The one way into a list's filters and sort: a title-bar icon that turns
 * the primary colour while any filter is on. Opens the screen's filter sheet.
 */
export function FilterButton({ activeCount, onPress }: { activeCount: number; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={pressScale.control}
      accessibilityRole="button"
      accessibilityLabel={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Icon name="sliders" size={22} color={activeCount > 0 ? colors.primary : colors.mutedForeground} />
    </Tappable>
  );
}
