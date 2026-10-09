import { useState, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { cn } from "@/lib/cn";

/** Press scales from the web: buttons 0.97, controls 0.98, tabs 0.95, player controls 0.9; 1 for rows. */
export type PressScale = 1 | 0.97 | 0.98 | 0.95 | 0.9;

export interface TappableProps extends Omit<PressableProps, "style" | "children" | "className"> {
  /** How far it shrinks while held; 1 for rows, which only fill. */
  scaleTo?: PressScale;
  className?: string | ((state: { pressed: boolean }) => string);
  style?: StyleProp<ViewStyle>;
  children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
}

/**
 * The web's press feedback on touch: the moment a finger lands the control
 * shrinks slightly and takes a darker fill (through `pressed`), and it lets
 * go on release. Instant on purpose: feedback belongs on press-in, never
 * after the tap has finished. (A plain style, not NativeWind's experimental
 * transitions, which remount the component on first use.)
 */
export function Tappable({ scaleTo = 0.97, className, style, children, disabled, onPressIn, onPressOut, ...props }: TappableProps) {
  const [pressed, setPressed] = useState(false);
  const state = { pressed };
  const shrink = pressed && !disabled && scaleTo !== 1;
  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={shrink ? [style, { transform: [{ scale: scaleTo }] }] : style}
      className={cn(typeof className === "function" ? className(state) : className)}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      {typeof children === "function" ? children(state) : children}
    </Pressable>
  );
}
