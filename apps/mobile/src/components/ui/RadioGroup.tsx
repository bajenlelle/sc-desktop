import { StyleSheet, View } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { selectionHaptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** A quiet count after the label. */
  count?: number;
}

/**
 * One choice out of a few, as a titled list with the chosen row checked: the
 * groups of a filter sheet. Plain rows on the sheet with inset hairlines.
 */
export function RadioGroup<T extends string>({
  title,
  options,
  value,
  onSelect,
}: {
  title: string;
  options: RadioOption<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  const colors = useThemeColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={title}>
      <Text variant="subheadline" className="px-4 pb-1 pt-4 text-muted-foreground">
        {title}
      </Text>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <View key={o.value}>
            {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 16, backgroundColor: colors.separator }} />}
            <Tappable
              scaleTo={1}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.count != null ? `${o.label}, ${o.count}` : o.label}
              onPress={() => {
                if (on) return;
                selectionHaptic();
                onSelect(o.value);
              }}
              className={({ pressed }) => cn("min-h-11 flex-row items-center gap-2.5 px-4", pressed && "bg-fill-1")}
            >
              <Text numberOfLines={1} className="flex-1">
                {o.label}
              </Text>
              {o.count != null ? (
                <Text nums className="text-muted-foreground">
                  {o.count}
                </Text>
              ) : null}
              <View className="w-[18px] items-end">
                {on ? <Icon name="check" size={18} strokeWidth={2.5} color={colors.primary} /> : null}
              </View>
            </Tappable>
          </View>
        );
      })}
    </View>
  );
}
