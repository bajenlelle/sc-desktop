import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

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
