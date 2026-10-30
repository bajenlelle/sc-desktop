import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { cn } from "@/lib/cn";

/** The settings sheet's rounder cards, as the iOS 26 Settings and Claude's settings draw them. */
const LARGE_RADIUS = "rounded-[22px]";

/**
 * The web's grouped (inset) lists (apps/web/src/components/ui/group.tsx), for
 * settings: a rounded card on the grouped floor (`bg-canvas`) with a hairline
 * ring, rows divided by hairlines inset to the text, a quiet heading above
 * and a footnote below. `large` is the settings sheet's: rounder, for its
 * taller rows.
 */
export function GroupedList({
  children,
  className,
  inset = 16,
  large = false,
}: {
  children: ReactNode;
  className?: string;
  /** Where the dividers start: 16 under plain rows, 46 under rows with an icon, 50 under large ones. */
  inset?: number;
  large?: boolean;
}) {
  const colors = useThemeColors();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View
      className={cn("overflow-hidden bg-card", large ? LARGE_RADIUS : "rounded-window", className)}
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator }}
    >
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: colors.separator }} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** A settings group's heading: quiet, sentence case, aligned with the rows' text. */
export function GroupHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <View className={cn("flex-row items-end justify-between gap-3 px-4 pb-1.5", className)}>
      {typeof title === "string" ? (
        <Text variant="subheadline" className="text-muted-foreground">
          {title}
        </Text>
      ) : (
        title
      )}
      {action}
    </View>
  );
}

export function GroupFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text variant="footnote" className={cn("px-4 pt-1.5 text-muted-foreground", className)}>
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
  /** A red label (and icon), for actions that delete or sign out. */
  destructive?: boolean;
  /** The settings sheet's row: 52 pt, a 22 pt icon. */
  large?: boolean;
  accessibilityLabel?: string;
  className?: string;
  children?: ReactNode;
}

/** A 44 pt row (52 when large): icon, label over description, trailing value, chevron; fills while pressed if tappable. */
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
  large = false,
  accessibilityLabel,
  className,
  children,
}: GroupRowProps) {
  const colors = useThemeColors();
  // At the largest text sizes the trailing control moves under the text
  // instead of squeezing it to a word per line, as iOS's own cells do.
  const stacked = useLargeText() && trailing != null && !children;
  const trailingView =
    trailing == null ? null : typeof trailing === "string" ? (
      <Text className={cn("text-muted-foreground", !stacked && "shrink-0")} numberOfLines={stacked ? undefined : 1}>
        {trailing}
      </Text>
    ) : (
      <View className={cn("flex-row flex-wrap items-center gap-2", !stacked && "shrink-0")}>{trailing}</View>
    );
  const main = (
    <>
      {(leading || icon) && (
        <View className="shrink-0 items-center justify-center">
          {leading ??
            (icon ? (
              <Icon name={icon} size={large ? 22 : 18} color={destructive ? colors.destructive : colors.mutedForeground} />
            ) : null)}
        </View>
      )}
      <View className="min-w-0 flex-1">
        {typeof label === "string" ? (
          <Text numberOfLines={stacked ? undefined : 1} className={destructive ? "text-destructive" : undefined}>
            {label}
          </Text>
        ) : (
          label
        )}
        {typeof description === "string" ? (
          <Text variant="subheadline" className="text-muted-foreground">
            {description}
          </Text>
        ) : (
          description
        )}
      </View>
    </>
  );
  const chevronView = chevron ? (
    <Icon name="chevronRight" size={16} strokeWidth={2} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
  ) : null;
  const body =
    children ??
    (stacked ? (
      <>
        <View className="flex-row items-center gap-3">
          {main}
          {chevronView}
        </View>
        <View className="self-start">{trailingView}</View>
      </>
    ) : (
      <>
        {main}
        {trailingView}
        {chevronView}
      </>
    ));
  const minH = large ? "min-h-[52px]" : "min-h-11";
  const box = stacked ? cn(minH, "gap-2 px-4 py-2.5") : cn(minH, "flex-row items-center gap-3 px-4 py-2");
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
