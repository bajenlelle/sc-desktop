import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";
import { useColorScheme } from "react-native";
import { themeColors } from "@/lib/theme";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";

interface ButtonProps extends Omit<PressableProps, "children"> {
  title: string;
  variant?: Variant;
  loading?: boolean;
  /** Extra classes appended to the container. */
  className?: string;
}

const container: Record<Variant, string> = {
  primary: "bg-primary dark:bg-primary-dark active:opacity-80",
  secondary: "bg-secondary dark:bg-secondary-dark active:opacity-70",
  outline:
    "border border-border dark:border-border-dark bg-transparent active:bg-muted dark:active:bg-muted-dark",
  ghost: "bg-transparent active:bg-muted dark:active:bg-muted-dark",
  destructive: "bg-destructive dark:bg-destructive-dark active:opacity-80",
};

const label: Record<Variant, string> = {
  primary: "text-primary-foreground dark:text-primary-foreground-dark",
  secondary: "text-foreground dark:text-foreground-dark",
  outline: "text-foreground dark:text-foreground-dark",
  ghost: "text-foreground dark:text-foreground-dark",
  destructive: "text-white",
};

export function Button({
  title,
  variant = "primary",
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={`min-h-[48px] flex-row items-center justify-center rounded-lg px-4 ${container[variant]} ${
        isDisabled ? "opacity-50" : ""
      } ${className}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.primaryForeground : colors.primary}
        />
      ) : (
        <Text className={`text-base font-semibold ${label[variant]}`}>{title}</Text>
      )}
    </Pressable>
  );
}
