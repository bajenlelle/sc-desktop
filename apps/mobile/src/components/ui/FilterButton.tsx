import { GlassButton } from "@/components/shell/GlassButton";
import { Icon } from "@/components/ui/Icon";
import { useThemeColors } from "@/lib/theme-context";

/**
 * The one way into a list's filters and sort: a glass button at the bar's
 * right end whose icon turns the primary colour while any filter is on.
 */
export function FilterButton({ activeCount, onPress }: { activeCount: number; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <GlassButton onPress={onPress} accessibilityLabel={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}>
      <Icon name="sliders" size={20} color={activeCount > 0 ? colors.primary : colors.foreground} />
    </GlassButton>
  );
}
