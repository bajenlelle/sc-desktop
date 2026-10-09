import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Tappable, type TappableProps } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

type Variant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type Size = "default" | "sm" | "xs" | "lg" | "icon" | "icon-sm" | "icon-xs";

/** Touch sizes from the web (apps/web/src/components/ui/button.tsx, pointer: coarse). */
const SIZE: Record<Size, { box: string; text: "body" | "footnote" }> = {
  default: { box: "h-11 px-5 gap-2", text: "body" },
  sm: { box: "h-10 px-4 gap-1.5", text: "body" },
  xs: { box: "h-9 px-3 gap-1", text: "footnote" },
  lg: { box: "h-12 px-6 gap-2", text: "body" },
  icon: { box: "h-11 w-11", text: "body" },
  "icon-sm": { box: "h-10 w-10", text: "body" },
  "icon-xs": { box: "h-9 w-9", text: "footnote" },
};

function variantBox(variant: Variant, pressed: boolean): string {
  switch (variant) {
    case "default":
      return pressed ? "bg-primary/80" : "bg-primary";
    case "destructive":
      return pressed ? "bg-destructive/80" : "bg-destructive";
    case "outline":
      return cn("border border-separator", pressed ? "bg-fill-3" : "bg-card");
    case "secondary":
      return pressed ? "bg-fill-4" : "bg-fill-2";
    case "ghost":
      return pressed ? "bg-fill-3" : "bg-transparent";
    case "link":
      return "bg-transparent";
  }
}

const TEXT_COLOR: Record<Variant, string> = {
  default: "text-primary-foreground",
  destructive: "text-white",
  outline: "text-foreground",
  secondary: "text-foreground",
  ghost: "text-foreground",
  link: "text-primary",
};

export interface ButtonProps extends Omit<TappableProps, "children" | "className"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** A leading icon (an <Icon/>), or the whole content of an icon button. */
  icon?: ReactNode;
  children?: string;
  className?: string;
  textClassName?: string;
}

/**
 * The web's Button at touch sizes: 44 pt by default, label weight 500,
 * radius 4. Disabled buttons fade to half but still receive taps, so an
 * accessibility hint can say why.
 */
export function Button({
  variant = "default",
  size = "default",
  loading = false,
  icon,
  children,
  className,
  textClassName,
  disabled,
  ...props
}: ButtonProps) {
  const colors = useThemeColors();
  const s = SIZE[size];
  const off = disabled || loading;
  const spinnerColor = variant === "default" ? colors.primaryForeground : variant === "destructive" ? "#ffffff" : colors.mutedForeground;
  return (
    <Tappable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: loading }}
      scaleTo={variant === "link" || off ? 1 : 0.97}
      disabled={off}
      className={({ pressed }) =>
        cn("flex-row items-center justify-center rounded-md", s.box, variantBox(variant, pressed && !off), off && "opacity-50", className)
      }
      {...props}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : icon}
      {children ? (
        <Text variant={s.text} className={cn("font-medium", TEXT_COLOR[variant], textClassName)} numberOfLines={1}>
          {children}
        </Text>
      ) : !icon && !loading ? (
        <View />
      ) : null}
    </Tappable>
  );
}
