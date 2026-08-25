import { forwardRef } from "react";
import { Text, TextInput, View, useColorScheme, type TextInputProps } from "react-native";
import { themeColors } from "@/lib/theme";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, className = "", ...props },
  ref
) {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);
  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-1.5 text-sm font-medium text-foreground dark:text-foreground-dark">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.mutedForeground}
        className={`min-h-[48px] w-full rounded-lg border border-input dark:border-input-dark bg-background dark:bg-card-dark px-3 text-base text-foreground dark:text-foreground-dark ${
          error ? "border-destructive dark:border-destructive-dark" : ""
        } ${className}`}
        {...props}
      />
      {error ? (
        <Text className="mt-1 text-sm text-destructive dark:text-destructive-dark">{error}</Text>
      ) : null}
    </View>
  );
});
