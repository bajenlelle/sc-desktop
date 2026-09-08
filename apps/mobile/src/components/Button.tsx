import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";
import { useThemeColors } from "@/lib/theme-context";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";

interface ButtonProps extends Omit<PressableProps, "children"> {
  title: string;
  variant?: Variant;
  loading?: boolean;
  /** Extra classes appended to the container. */
  className?: string;
}

const container: Record<Variant, string> = {
  primary: "bg-primary active:opacity-80",
  secondary: "bg-secondary active:opacity-70",
  outline:
    "border border-border bg-transparent active:bg-muted",
  ghost: "bg-transparent active:bg-muted",
  destructive: "bg-destructive active:opacity-80",
};

const label: Record<Variant, string> = {
  primary: "text-primary-foreground",
  secondary: "text-foreground",
  outline: "text-foreground",
  ghost: "text-foreground",
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
  const colors = useThemeColors();
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
