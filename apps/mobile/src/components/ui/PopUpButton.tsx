import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
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
 * the pop-up menu from itself with the current choice checked. A 36 pt control with a 44 pt
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
  const anchor = useRef<View>(null);
  return (
    <View ref={anchor} collapsable={false} className={cn("self-start", className)}>
      <Tappable
        scaleTo={pressScale.control}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${current?.label ?? ""}` : current?.label}
        hitSlop={4}
        onPress={() => setOpen(true)}
        className={({ pressed }) =>
          cn(
            "min-h-9 flex-row items-center gap-1.5 rounded-control py-1 pl-3 pr-2",
            pressed ? "bg-fill-2" : "bg-card",
          )
        }
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separatorStrong }}
      >
        <Text variant="subheadline" numberOfLines={1}>
          {current?.label ?? "Choose…"}
        </Text>
        <Icon name="chevronUpDown" size={14} weight="semibold" color={colors.mutedForeground} />
      </Tappable>
      <PopoverMenu
        visible={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        accessibilityLabel={title ?? accessibilityLabel}
        groups={[
          {
            key: "options",
            items: options.map((o) => ({
              key: o.value,
              label: o.label,
              checked: o.value === value,
              onSelect: () => {
                if (o.value !== value) onValueChange(o.value);
              },
            })),
          },
        ]}
      />
    </View>
  );
}
