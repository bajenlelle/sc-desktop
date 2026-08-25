import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Mobile stand-in for the web feed's dropdown menus: a compact trigger that
 * opens a bottom-sheet-style option list.
 */
export function Select({
  prefix,
  options,
  value,
  onChange,
}: {
  /** Short label rendered before the trigger, e.g. "From" / "To". */
  prefix?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";

  return (
    <View className="flex-row items-center gap-1.5">
      {prefix ? (
        <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {prefix}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="min-h-[36px] flex-row items-center gap-1 rounded-md border border-border dark:border-border-dark px-2.5 active:bg-muted dark:active:bg-muted-dark"
      >
        <Text
          numberOfLines={1}
          className="max-w-[9rem] text-xs font-medium text-foreground dark:text-foreground-dark"
        >
          {activeLabel}
        </Text>
        <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <Pressable
            className="max-h-[60%] rounded-t-2xl bg-card dark:bg-card-dark pb-8 pt-2"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mx-auto my-2 h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
            <ScrollView>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="min-h-[48px] flex-row items-center justify-between px-5 active:bg-muted dark:active:bg-muted-dark"
                >
                  <Text
                    className={`text-base ${
                      o.value === value
                        ? "font-semibold text-primary dark:text-primary-dark"
                        : "text-foreground dark:text-foreground-dark"
                    }`}
                  >
                    {o.label}
                  </Text>
                  {o.value === value ? (
                    <Text className="text-primary dark:text-primary-dark">✓</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
