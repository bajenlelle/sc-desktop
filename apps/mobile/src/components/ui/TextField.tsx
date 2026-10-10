import { forwardRef, useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { rgba } from "@scoutable/shared/lib/theme-derived";
import { Text } from "@/components/ui/Text";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

/**
 * The web's input at touch size: 44 pt tall, 6 pt corners, the card colour
 * with a 1 pt separator ring that turns accent-coloured (2 pt) while
 * focused, and destructive when invalid. Text at body size (17 pt), which
 * also keeps iOS from zooming. `multiline` makes it a text area.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, multiline, className, style, onFocus, onBlur, ...props },
  ref,
) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const ring = error ? rgba(colors.destructive, 0.4) : focused ? colors.primary : colors.separator;
  const thick = focused || !!error;
  return (
    <View className="w-full gap-1.5">
      {label ? (
        <Text variant="subheadline" className="font-medium">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn("w-full rounded-lg bg-card text-foreground", multiline ? "min-h-28" : "h-11", className)}
        style={[
          {
            fontSize: 17,
            borderWidth: thick ? 2 : 1,
            borderColor: ring,
            // The thicker ring doesn't move the text.
            paddingHorizontal: thick ? 11 : 12,
            paddingVertical: multiline ? (thick ? 9 : 10) : 0,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text variant="subheadline" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
});
