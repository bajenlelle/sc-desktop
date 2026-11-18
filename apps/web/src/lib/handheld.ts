import { useSyncExternalStore } from "react";

// Twin of sc-landing's lib/platform.ts `detectHandheld` / `useHandheld`
// (sc-landing-redesign/lib/platform.ts). Keep the two in step.

/** A phone or tablet: it cannot run the desktop app. */
export function detectHandheld(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(nav.userAgent)) return true;
  // iPadOS Safari reports itself as a Mac; touch gives it away.
  return /Mac OS X/i.test(nav.userAgent) && nav.maxTouchPoints > 1;
}

const subscribe = () => () => {};

/** Server render and hydration see false (the desktop button); a phone or tablet then swaps in its own. */
export function useHandheld(): boolean {
  return useSyncExternalStore(subscribe, detectHandheld, () => false);
}
