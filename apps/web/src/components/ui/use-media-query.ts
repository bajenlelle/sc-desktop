"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept current as the window changes; false
 * while rendering on the server, so a layout decided by it settles on the
 * client's first paint. For viewport-wide choices (a sheet on a phone, a
 * panel on a desktop); container queries stay in CSS.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-width screens, the width under which dialogs become sheets (ui/dialog.tsx). */
export const COMPACT_QUERY = "(max-width: 639px)";
