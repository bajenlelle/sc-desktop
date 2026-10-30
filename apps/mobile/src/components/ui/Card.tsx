import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/**
 * One item of a content list as its own card on the grouped floor (the
 * screen's `grouped` canvas): the same surface, radius and hairline as a
 * GroupedList, with the page gutter around it. Shared by me and Shared with
 * me put one playlist in each, so items separate at a glance.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  const colors = useThemeColors();
  return (
    <View
      className={cn("mx-4 overflow-hidden rounded-window bg-card", className)}
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator }}
    >
      {children}
    </View>
  );
}
