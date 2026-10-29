import { useState } from "react";
import { StyleSheet } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { MenuSheet } from "@/components/ui/Sheet";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { pressScale } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

export interface PopUpOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The web's pop-up button: the current choice with up/down chevrons, opening
 * a menu sheet with the current choice checked. A 36 pt control with a 44 pt
 * touch target, the same on iOS and Android.
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
  /** The menu's heading. */
  title?: string;
  className?: string;
  accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Tappable
        scaleTo={pressScale.control}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${current?.label ?? ""}` : current?.label}
        hitSlop={4}
        onPress={() => setOpen(true)}
        className={({ pressed }) =>
          cn(
            "min-h-9 flex-row items-center gap-1.5 self-start rounded-control py-1 pl-3 pr-2",
            pressed ? "bg-fill-2" : "bg-card",
            className,
          )
        }
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separatorStrong }}
      >
        <Text variant="subheadline" numberOfLines={1}>
          {current?.label ?? "Choose…"}
        </Text>
        <Icon name="chevronUpDown" size={14} weight="semibold" color={colors.mutedForeground} />
      </Tappable>
      <MenuSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={title ?? accessibilityLabel}
        options={options}
        value={value}
        onSelect={(next) => {
          if (next !== value) onValueChange(next);
        }}
      />
    </>
  );
}
