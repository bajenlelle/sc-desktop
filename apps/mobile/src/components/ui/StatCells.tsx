import { View } from "react-native";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useLargeText } from "@/lib/a11y";
import { cn } from "@/lib/cn";

export interface StatCell {
  value: number;
  label: string;
  /** The figure in the warning colour (someone is behind). */
  warn?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
}

/** A row of figures in one group, split by hairlines (the web's Shared by me summary). */
export function StatCells({ cells, className }: { cells: StatCell[]; className?: string }) {
  // At the largest text sizes the figures stack, each beside its label,
  // rather than breaking the labels a few letters per line.
  const largeText = useLargeText();
  return (
    <View className={cn("overflow-hidden rounded-window border border-separator bg-card", !largeText && "flex-row", className)}>
      {cells.map((c, i) => {
        const body = (
          <>
            <Text variant="title2" nums className={c.warn ? "text-warning" : undefined}>
              {String(c.value)}
            </Text>
            <Text variant="callout" className={cn("text-muted-foreground", largeText && "flex-1")}>
              {c.label}
            </Text>
          </>
        );
        const box = largeText
          ? cn("flex-row items-baseline gap-3 px-4 py-2.5", i > 0 && "border-t border-separator")
          : cn("flex-1 px-4 py-3", i > 0 && "border-l border-separator");
        return c.onPress ? (
          <Tappable
            key={c.label}
            scaleTo={1}
            accessibilityRole="button"
            accessibilityHint={c.accessibilityHint}
            onPress={c.onPress}
            className={({ pressed }) => cn(box, pressed && "bg-fill-2")}
          >
            {body}
          </Tappable>
        ) : (
          <View key={c.label} className={box}>
            {body}
          </View>
        );
      })}
    </View>
  );
}
