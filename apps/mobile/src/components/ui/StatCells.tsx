import { View } from "react-native";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
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
  return (
    <View className={cn("flex-row overflow-hidden rounded-window border border-separator bg-card", className)}>
      {cells.map((c, i) => {
        const body = (
          <>
            <Text variant="title2" nums className={c.warn ? "text-warning" : undefined}>
              {String(c.value)}
            </Text>
            <Text variant="callout" className="text-muted-foreground">
              {c.label}
            </Text>
          </>
        );
        const box = cn("flex-1 px-4 py-3", i > 0 && "border-l border-separator");
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
