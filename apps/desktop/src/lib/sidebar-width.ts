/**
 * The window sidebar's width, dragged by its edge: a tiny external store like
 * sidebar-store.ts (which keeps whether it is shown), persisted per machine.
 * Collapsing doesn't touch it, so the sidebar comes back at the width it had.
 */
import { useSyncExternalStore } from "react";
import type { ColumnLimits } from "@/lib/use-column-resize";

/** Short labels: wider than Mail's, narrower than Notion's 480. */
export const SIDEBAR_WIDTH: ColumnLimits = { default: 220, min: 180, max: 360 };

const KEY = "scoutable_sidebar_width";

let width = (() => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= SIDEBAR_WIDTH.min && n <= SIDEBAR_WIDTH.max ? n : SIDEBAR_WIDTH.default;
  } catch {
    return SIDEBAR_WIDTH.default;
  }
})();

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSidebarWidth(): number {
  return useSyncExternalStore(subscribe, () => width, () => width);
}

export function setSidebarWidth(next: number) {
  const clamped = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, next)));
  if (clamped === width) return;
  width = clamped;
  try {
    localStorage.setItem(KEY, String(clamped));
  } catch {
    /* private mode or quota: the session still works */
  }
  for (const listener of listeners) listener();
}
