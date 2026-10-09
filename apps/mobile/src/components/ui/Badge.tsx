import { View } from "react-native";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

const VARIANT = {
  default: { box: "bg-primary", text: "text-primary-foreground" },
  secondary: { box: "bg-fill-2", text: "text-foreground" },
  destructive: { box: "bg-destructive/[0.12]", text: "text-destructive" },
  success: { box: "bg-success/[0.14]", text: "text-success" },
  warning: { box: "bg-warning/[0.14]", text: "text-warning" },
  outline: { box: "border border-separator", text: "text-foreground" },
} as const;

/** The web's Badge: a pill in subheadline weight 500, tinted rather than loud. */
export function Badge({
  variant = "default",
  children,
  className,
}: {
  variant?: keyof typeof VARIANT;
  children: string;
  className?: string;
}) {
  const v = VARIANT[variant];
  return (
    <View className={cn("self-start rounded-full px-2 py-px", v.box, className)}>
      <Text variant="subheadline" className={cn("font-medium", v.text)} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}
