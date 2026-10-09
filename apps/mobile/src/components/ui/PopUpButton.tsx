import { View } from "react-native";
import { MenuView } from "@expo/ui/community/menu";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { selectionHaptic } from "@/lib/haptics";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

export interface PopUpOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The web's pop-up button: the current choice with up/down chevrons, opening
 * the platform's own menu (a SwiftUI menu on iOS, Material's dropdown on
 * Android) with the current choice checked. A 36 pt control with a 44 pt
 * touch target.
 */
export function PopUpButton<T extends string>({
  value,
  onValueChange,
  options,
  title,
  className,
  accessibilityLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: PopUpOption<T>[];
  /** The menu's heading (iOS). */
  title?: string;
  className?: string;
  accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const current = options.find((o) => o.value === value);
  return (
    <MenuView
      title={title}
      colorScheme={resolvedMode}
      actions={options.map((o) => ({ id: o.value, title: o.label, state: o.value === value ? "on" : "off" }))}
      onPressAction={({ nativeEvent }) => {
        const next = nativeEvent.event as T;
        if (next !== value) {
          selectionHaptic();
          onValueChange(next);
        }
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${current?.label ?? ""}` : current?.label}
        hitSlop={4}
        className={cn("h-9 flex-row items-center gap-1.5 self-start rounded-lg border border-separator bg-card pl-3 pr-2", className)}
      >
        <Text variant="callout" numberOfLines={1}>
          {current?.label ?? "Choose…"}
        </Text>
        <Icon name="chevronUpDown" size={12} weight="semibold" color={colors.mutedForeground} />
      </View>
    </MenuView>
  );
}
