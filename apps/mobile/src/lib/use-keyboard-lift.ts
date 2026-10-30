import { useEffect } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Easing, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

/**
 * How far something pinned to the bottom of the screen must rise to sit on
 * the keyboard, animated with it (iOS reports its timing ahead of the move;
 * Android only after, so it follows a beat late). iOS reports the keyboard's
 * full height, which covers the home-indicator inset the pinned thing
 * already pads for, so that inset comes off; React Native on Android reports
 * the height above the navigation bar, so it is the lift as it is (taking
 * the inset off there too left the search capsule half under the keyboard).
 * No native module: the app's dev clients and store build stay as they are.
 */
export function useKeyboardLift(): SharedValue<number> {
  const lift = useSharedValue(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      const height = ios ? e.endCoordinates.height - insets.bottom : e.endCoordinates.height;
      lift.value = withTiming(Math.max(0, height), {
        duration: ios ? e.duration || 250 : 160,
        easing: Easing.out(Easing.cubic),
      });
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      lift.value = withTiming(0, { duration: ios ? e.duration || 250 : 160, easing: Easing.out(Easing.cubic) });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom, lift]);
  return lift;
}
