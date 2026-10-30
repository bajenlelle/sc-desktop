import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useLargeText } from "@/lib/a11y";
import { LEADING_GAP, LEADING_SLOT, PAGE_X } from "@/lib/layout";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/**
 * Content lists (playlists, clips, teams) as the desktop's and Notion's:
 * rows straight on the page, divided by hairlines that start at the text, no
 * card around them. Settings use GroupedList instead.
 */
export function PlainList({ children, inset = PAGE_X }: { children: ReactNode; inset?: number }) {
  const colors = useThemeColors();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: colors.separator }} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** Where a PlainList's dividers start under rows that have a leading slot. */
export const LEADING_INSET = PAGE_X + LEADING_SLOT + LEADING_GAP;

export interface RowProps {
  /** An 18 pt slot before the text: a progress ring, a dot. */
  leading?: ReactNode;
  label: string;
  /** A muted line above the label: where the row comes from (a playlist's team). */
  overline?: string | null;
  /** Semibold for something new, regular otherwise. */
  emphasis?: boolean;
  description?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  className?: string;
}

/**
 * A content row: label over a muted description, an optional leading slot,
 * one trailing control or a chevron. 56 pt for two lines; fills while pressed.
 * At the largest text sizes the trailing control moves under the text.
 */
export function Row({
  leading,
  label,
  overline,
  emphasis,
  description,
  trailing,
  chevron,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  className,
}: RowProps) {
  const colors = useThemeColors();
  const large = useLargeText();
  const stacked = large && trailing != null;
  const text = (
    <View className="min-w-0 flex-1">
      {overline ? (
        <Text variant="footnote" numberOfLines={large ? 2 : 1} className="text-muted-foreground">
          {overline}
        </Text>
      ) : null}
      <Text numberOfLines={large ? 3 : 1} className={emphasis ? "font-semibold" : undefined}>
        {label}
      </Text>
      {typeof description === "string" ? (
        <Text variant="subheadline" nums numberOfLines={large ? undefined : 1} className="text-muted-foreground">
          {description}
        </Text>
      ) : (
        description
      )}
      {stacked ? <View className="mt-1.5 self-start">{trailing}</View> : null}
    </View>
  );
  const body = (
    <>
      {leading !== undefined && (
        <View style={{ width: LEADING_SLOT }} className="items-center justify-center self-center">
          {leading}
        </View>
      )}
      {text}
      {!stacked && trailing != null ? <View className="shrink-0">{trailing}</View> : null}
      {chevron ? <Icon name="chevronRight" size={16} strokeWidth={2} color={colors.mutedForeground} style={{ opacity: 0.5 }} /> : null}
    </>
  );
  const box = "min-h-14 flex-row items-center gap-3 px-4 py-2";
  if (!onPress) return <View className={cn(box, className)}>{body}</View>;
  return (
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      className={({ pressed }) => cn(box, pressed && "bg-fill-1", className)}
    >
      {body}
    </Tappable>
  );
}

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
 * Figures as one quiet sentence ("9 playlists shared · 14 players reached ·
 * 3 haven't finished") instead of a row of stat cells; the part that leads
 * somewhere is a tinted text action.
 */
export function StatLine({
  parts,
  action,
  className,
}: {
  parts: string[];
  action?: { label: string; onPress: () => void };
  className?: string;
}) {
  const text = parts.join(" · ");
  return (
    <Text variant="subheadline" nums className={cn("px-4 text-muted-foreground", className)}>
      {text}
      {action ? (
        <>
          {text ? " · " : ""}
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
