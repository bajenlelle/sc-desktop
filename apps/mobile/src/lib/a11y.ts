import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, useWindowDimensions } from "react-native";

/**
 * The system's Reduce Transparency setting (iOS; Android has none): blurred
 * materials turn solid under it, as on the web's prefers-reduced-transparency.
 */
export function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AccessibilityInfo.isReduceTransparencyEnabled().then(setOn).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setOn);
    return () => sub.remove();
  }, []);
  return on;
}

/**
 * Text at the largest sizes (iOS xxxLarge and the accessibility sizes,
 * Android's top font scales): layouts with things side by side give way,
 * as iOS's own do: segmented controls become a menu, rows put their
 * trailing control under the text, button pairs stack.
 */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= 1.3;
}
