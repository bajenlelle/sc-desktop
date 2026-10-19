/**
 * Sidebar collapsed state: a tiny external store so the toolbar's toggle and
 * the sidebar itself agree without a provider, persisted per machine. The
 * html attribute lets CSS reserve room for the traffic lights when the
 * sidebar that normally holds them is gone.
 */
import { useSyncExternalStore } from "react";

const KEY = "scoutable_sidebar_collapsed";

let collapsed = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function project() {
  document.documentElement.dataset.sidebarCollapsed = collapsed ? "true" : "false";
}
project();

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => collapsed, () => collapsed);
}

export function setSidebarCollapsed(next: boolean) {
  if (next === collapsed) return;
  collapsed = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* private mode or quota: the session still works */
  }
  project();
  for (const listener of listeners) listener();
}

export function toggleSidebar() {
  setSidebarCollapsed(!collapsed);
}
