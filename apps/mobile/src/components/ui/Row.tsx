import { Fragment, type ReactNode } from "react";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/** A content section's heading: the headline with a quiet count after it. */
export function SectionHeader({ title, count, className }: { title: string; count?: number | string; className?: string }) {
  return (
    <View accessibilityRole="header" className={cn("flex-row items-baseline gap-1.5 px-4 pb-1.5 pt-6", className)}>
      <Text variant="headline">{title}</Text>
      {count != null && count !== "" ? (
        <Text nums className="text-muted-foreground">
          {String(count)}
        </Text>
      ) : null}
    </View>
  );
}

/** A small round mark: 8 pt for "new", 6 pt for an event's colour family. */
export function Dot({ size = 8, color }: { size?: 6 | 8; color: string }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
    />
  );
}

export interface NoticeAction {
  label: string;
  onPress: () => void;
  /** The tinted action; others are muted. */
  primary?: boolean;
}

/**
 * A one-line notice between a screen's controls and its content (a licence
 * that expired, a permission to ask for): an icon and a footnote, no box, the
 * actions as text. Calmer than a callout, which stays for errors in forms.
 */
export function NoticeRow({
  icon,
  tone = "neutral",
  children,
  actions,
  className,
}: {
  icon: IconName;
  tone?: "neutral" | "destructive";
  children: ReactNode;
  actions?: NoticeAction[];
  className?: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      accessibilityRole={tone === "destructive" ? "alert" : undefined}
      className={cn("flex-row items-start gap-2.5 px-4 py-2", className)}
    >
      <View className="mt-px">
        <Icon name={icon} size={16} color={tone === "destructive" ? colors.destructive : colors.mutedForeground} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        {typeof children === "string" ? (
          <Text variant="footnote" className="text-muted-foreground">
            {children}
          </Text>
        ) : (
          children
        )}
        {actions && actions.length > 0 ? (
          <View className="flex-row flex-wrap gap-4">
            {actions.map((a) => (
              <Tappable key={a.label} scaleTo={0.97} hitSlop={8} accessibilityRole="button" onPress={a.onPress}>
                <Text variant="footnote" className={a.primary ? "font-semibold text-primary" : "text-muted-foreground"}>
                  {a.label}
                </Text>
              </Tappable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Figures as one line ("9 playlists shared · 14 players reached · 3 haven't
 * finished") instead of a row of stat cells: each figure in the text colour
 * and semibold, its words muted, so the numbers stand out when scanning. The
 * part that leads somewhere is a tinted text action.
 */
export function StatLine({
  parts,
  action,
  className,
}: {
  parts: { figure: number | string; label: string }[];
  action?: { label: string; onPress: () => void };
  className?: string;
}) {
  return (
    <Text variant="subheadline" nums className={cn("px-4 text-muted-foreground", className)}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? " · " : ""}
          <Text variant="subheadline" nums className="font-semibold text-foreground">
            {String(p.figure)}
          </Text>{" "}
          {p.label}
        </Fragment>
      ))}
      {action ? (
        <>
          {parts.length > 0 ? " · " : ""}
          <Text
            variant="subheadline"
            accessibilityRole="button"
            onPress={action.onPress}
            className="font-semibold text-primary"
          >
            {action.label}
          </Text>
        </>
      ) : null}
    </Text>
  );
}

/**
 * A text action inside a row or a line of text (Resume, Remind, Clear): the
 * label in the primary colour, no box, a 44 pt touch area through hitSlop.
 */
export function TextButton({
  label,
  onPress,
  accessibilityLabel,
  muted,
  size = "subheadline",
  disabled,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** The quiet one of a pair (Not now). */
  muted?: boolean;
  size?: "subheadline" | "footnote" | "body";
  disabled?: boolean;
}) {
  return (
    <Tappable
      scaleTo={0.97}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={disabled ? "opacity-50" : undefined}
    >
      <Text variant={size} className={muted ? "text-muted-foreground" : "font-semibold text-primary"}>
        {label}
      </Text>
    </Tappable>
  );
}
