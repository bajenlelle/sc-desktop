import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { useThemeColors } from "@/lib/theme-context";

/**
 * A list's empty state: a quiet icon, a title, one line, and the next step
 * (a text button). No tinted well: the icon alone, as Notion and the
 * desktop's sidebar do.
 */
export function EmptyState({ icon, title, body, action }: { icon?: IconName; title: string; body: string; action?: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View className="items-center justify-center px-6 py-12">
      {icon && (
        <View className="mb-2.5">
          <Icon name={icon} size={28} color={colors.mutedForeground} />
        </View>
      )}
      <Text variant="headline" className="text-center">
        {title}
      </Text>
      <Text variant="subheadline" className="mt-0.5 max-w-sm text-center text-muted-foreground">
        {body}
      </Text>
      {action && <View className="mt-2">{action}</View>}
    </View>
  );
}

/** A whole-screen state (blocked, broken, waiting): icon, title, body, then the way forward. */
export function StatusScreen({
  icon,
  title,
  body,
  children,
  actions,
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center bg-background px-6 py-12">
      <View className="w-full max-w-md items-center">
        {icon && (
          <View className="mb-3">
            <Icon name={icon} size={28} color={colors.mutedForeground} />
          </View>
        )}
        <Text variant="title2" accessibilityRole="header" className="text-center">
          {title}
        </Text>
        {typeof body === "string" ? (
          <Text variant="subheadline" className="mt-1.5 text-center text-muted-foreground">
            {body}
          </Text>
        ) : (
          body
        )}
        {children && <View className="mt-5 w-full">{children}</View>}
        {actions && <View className="mt-6 w-full gap-2">{actions}</View>}
      </View>
    </View>
  );
}
