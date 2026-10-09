import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/**
 * The web's grouped (inset) lists (apps/web/src/components/ui/group.tsx):
 * a rounded card with a 1 pt separator ring, rows divided by full-width
 * hairlines, a bold headline above and a quiet footnote below. In the light
 * theme the card is the page colour; the ring does the separating.
 */
export function GroupedList({ children, className }: { children: ReactNode; className?: string }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View className={cn("overflow-hidden rounded-window border border-separator bg-card", className)}>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 && <View className="h-px bg-separator" />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export function GroupHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <View className={cn("flex-row items-end justify-between gap-3 px-1 pb-2", className)}>
      {typeof title === "string" ? <Text variant="headline">{title}</Text> : title}
      {action}
    </View>
  );
}

export function GroupFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text variant="subheadline" className={cn("px-1 pt-2 text-muted-foreground", className)}>
      {children}
    </Text>
  );
}

export interface GroupRowProps {
  label?: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  /** An icon by name, shown in the leading slot. */
  icon?: IconName;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** A red label, for actions that delete. */
  destructive?: boolean;
  accessibilityLabel?: string;
  className?: string;
  children?: ReactNode;
}

/** A 44 pt row: icon, label over description, trailing value, chevron; fills while pressed if tappable. */
export function GroupRow({
  label,
  description,
  leading,
  icon,
  trailing,
  chevron,
  onPress,
  disabled,
  destructive,
  accessibilityLabel,
  className,
  children,
}: GroupRowProps) {
  const colors = useThemeColors();
  const body = children ?? (
    <>
      {(leading || icon) && (
        <View className="shrink-0 items-center justify-center">
          {leading ?? (icon ? <Icon name={icon} size={17} color={colors.mutedForeground} /> : null)}
        </View>
      )}
      <View className="min-w-0 flex-1">
        {typeof label === "string" ? (
          <Text numberOfLines={1} className={destructive ? "text-destructive" : undefined}>
            {label}
          </Text>
        ) : (
          label
        )}
        {typeof description === "string" ? (
          <Text variant="callout" className="text-muted-foreground">
            {description}
          </Text>
        ) : (
          description
        )}
      </View>
      {trailing != null &&
        (typeof trailing === "string" ? (
          <Text className="shrink-0 text-muted-foreground" numberOfLines={1}>
            {trailing}
          </Text>
        ) : (
          <View className="shrink-0 flex-row items-center gap-2">{trailing}</View>
        ))}
      {chevron && <Icon name="chevronRight" size={14} weight="semibold" color={colors.mutedForeground} style={{ opacity: 0.6 }} />}
    </>
  );
  const box = "min-h-11 flex-row items-center gap-3 px-4 py-2";
  if (!onPress) return <View className={cn(box, className)}>{body}</View>;
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={({ pressed }) => cn(box, pressed && "bg-fill-2", disabled && "opacity-50", className)}
    >
      {body}
    </Tappable>
  );
}

/** A settings-style row: the label in a fixed column, the control on the right. */
export function FormRow({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("min-h-11 flex-row items-center gap-4 px-4 py-2", className)}>
      <View className="w-32 shrink-0">
        <Text>{label}</Text>
        {description ? (
          <Text variant="callout" className="text-muted-foreground">
            {description}
          </Text>
        ) : null}
      </View>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-2">{children}</View>
    </View>
  );
}

const CALLOUT_TONE = {
  neutral: { box: "bg-fill-1", icon: "mutedForeground" },
  warning: { box: "bg-warning/[0.12]", icon: "warning" },
  destructive: { box: "bg-destructive/10", icon: "destructive" },
  success: { box: "bg-success/[0.12]", icon: "success" },
} as const;

/** A tinted note between groups: status, warning or error, with an optional action. */
export function Callout({
  tone = "neutral",
  icon,
  children,
  action,
  className,
}: {
  tone?: keyof typeof CALLOUT_TONE;
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const colors = useThemeColors();
  const t = CALLOUT_TONE[tone];
  return (
    <View
      accessibilityRole={tone === "destructive" ? "alert" : undefined}
      className={cn("flex-row items-start gap-2.5 rounded-window px-3 py-2.5", t.box, className)}
    >
      {icon && (
        <View className="mt-0.5">
          <Icon name={icon} size={16} color={colors[t.icon]} />
        </View>
      )}
      <View className="min-w-0 flex-1">
        {typeof children === "string" ? <Text variant="callout">{children}</Text> : children}
      </View>
      {action && <View className="shrink-0 self-center">{action}</View>}
    </View>
  );
}
