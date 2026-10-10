import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { selectionHaptic } from "@/lib/haptics";
import { springs } from "@/lib/motion";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { PopUpButton } from "@/components/ui/PopUpButton";
import { cn } from "@/lib/cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Shown after the label, quieter (counts). */
  detail?: string | number;
  accessibilityLabel?: string;
}

/**
 * The web's segmented control on touch: a recessed track with the selected
 * segment as a raised card that springs between segments (one shared
 * thumb), 32 pt segments in a 36 pt track. A selection tick on change.
 * With no value selected there is no thumb.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  segments,
  size = "sm",
  fullWidth = false,
  className,
  accessibilityLabel,
}: {
  value: T | null;
  onValueChange: (value: T) => void;
  segments: Segment<T>[];
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
  accessibilityLabel?: string;
}): ReactNode {
  const colors = useThemeColors();
  const dark = useAppTheme().resolvedMode === "dark";
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useRef(false);
  const frame = value != null ? frames[value] : undefined;

  useEffect(() => {
    if (!frame) return;
    if (!placed.current) {
      // First placement jumps; later changes spring from where the thumb is.
      x.value = frame.x;
      width.value = frame.width;
      placed.current = true;
    } else {
      x.value = withSpring(frame.x, springs.snappy);
      width.value = withSpring(frame.width, springs.snappy);
    }
  }, [frame, x, width]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: width.value }));

  const largeText = useLargeText();

  const onLayout = (v: T) => (e: LayoutChangeEvent) => {
    const { x: fx, width: fw } = e.nativeEvent.layout;
    setFrames((prev) => (prev[v]?.x === fx && prev[v]?.width === fw ? prev : { ...prev, [v]: { x: fx, width: fw } }));
  };

  // At the largest text sizes the segments can't share a row: the choice
  // becomes a pop-up menu, as iOS's own segmented controls do.
  if (largeText) {
    return (
      <PopUpButton<T>
        accessibilityLabel={accessibilityLabel}
        title={accessibilityLabel}
        value={(value ?? segments[0]?.value) as T}
        onValueChange={onValueChange}
        options={segments.map((s) => ({ value: s.value, label: s.detail != null ? `${s.label} (${s.detail})` : s.label }))}
        className={fullWidth ? "self-stretch justify-between" : undefined}
      />
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className={cn("flex-row self-start rounded-lg bg-fill-2 p-0.5", fullWidth && "self-stretch", className)}
    >
      {frame && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 2,
              bottom: 2,
              left: 0,
              borderRadius: 4,
              borderWidth: 0.5,
              borderColor: colors.separator,
              // In dark themes the card is darker than the track, which made the
              // choice read as a hole: there the thumb is a lighter fill instead,
              // as in Apple's own dark segmented control.
              backgroundColor: dark ? colors.fill3 : colors.card,
              ...(dark
                ? null
                : Platform.OS === "ios"
                  ? { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } }
                  : { elevation: 1 }),
            },
            thumb,
          ]}
        />
      )}
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Tappable
            key={s.value}
            scaleTo={0.98}
            onLayout={onLayout(s.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={s.accessibilityLabel}
            onPress={() => {
              if (s.value !== value) {
                selectionHaptic();
                onValueChange(s.value);
              }
            }}
            className={cn("h-8 flex-row items-center justify-center gap-1 rounded-md px-3.5", fullWidth && "flex-1")}
          >
            <Text
              variant={size === "sm" ? "footnote" : "body"}
              numberOfLines={1}
              className={cn("font-medium", selected ? "text-foreground" : "text-muted-foreground")}
            >
              {s.label}
            </Text>
            {s.detail != null && (
              <Text variant={size === "sm" ? "footnote" : "body"} nums className="text-muted-foreground/60">
                {String(s.detail)}
              </Text>
            )}
          </Tappable>
        );
      })}
    </View>
  );
}
