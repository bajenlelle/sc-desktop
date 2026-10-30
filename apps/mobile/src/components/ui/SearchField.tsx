import { useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/**
 * The web's search field at touch size, for screens without a native one
 * (Android's toolbar search hides behind an icon): recessed, with a
 * magnifier, the card colour and an accent ring while focused, and a clear
 * button once there's text.
 */
export function SearchField({
  value,
  onChangeText,
  className,
  ...props
}: Omit<TextInputProps, "value" | "onChangeText"> & { value: string; onChangeText: (text: string) => void }) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  return (
    <View
      className={cn("h-9 flex-row items-center rounded-control", focused ? "bg-card" : "bg-fill-1", className)}
      style={{ borderWidth: 2, borderColor: focused ? colors.primary : "transparent" }}
      hitSlop={{ top: 4, bottom: 4 }}
    >
      <View className="pl-2.5 pr-1.5">
        <Icon name="search" size={16} color={colors.mutedForeground} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        className="h-full flex-1 text-foreground"
        style={{ fontSize: 17, paddingVertical: 0 }}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
      />
      {value.length > 0 && (
        <Tappable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={6}
          onPress={() => onChangeText("")}
          className="h-full items-center justify-center px-2.5"
        >
          <View className="h-[18px] w-[18px] items-center justify-center rounded-full bg-muted-foreground/50">
            <Icon name="close" size={11} strokeWidth={2.5} color={colors.background} />
          </View>
        </Tappable>
      )}
    </View>
  );
}
