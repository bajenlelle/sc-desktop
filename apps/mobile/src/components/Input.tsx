import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { useThemeColors } from "@/lib/theme-context";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, className = "", ...props },
  ref
) {
  const colors = useThemeColors();
  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-1.5 text-sm font-medium text-foreground">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.mutedForeground}
        className={`min-h-[48px] w-full rounded-lg border border-input bg-background dark:bg-card px-3 text-base text-foreground ${
          error ? "border-destructive" : ""
        } ${className}`}
        {...props}
      />
      {error ? (
        <Text className="mt-1 text-sm text-destructive">{error}</Text>
      ) : null}
    </View>
  );
});
