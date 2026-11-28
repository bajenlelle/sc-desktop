/**
 * A page's second sidebar, shown or hidden: the Playlists page's playlist
 * browser and a report's Sections panel. A tiny external store like
 * sidebar-store.ts, so the toolbar's toggle, the View menu (⌘B) and the page
 * agree without a provider, persisted per machine. `present` says the page
 * with the column is mounted (and has it to show), which is when the toolbar
 * shows its toggle.
 */
import { useEffect, useSyncExternalStore } from "react";

export interface SideColumnStore {
  useCollapsed: () => boolean;
  usePresent: () => boolean;
  /** Called by the page that holds the column, for as long as it is mounted and the column can show. */
  useRegister: (active?: boolean) => void;
  isPresent: () => boolean;
  setCollapsed: (next: boolean) => void;
  toggle: () => void;
}

export function createSideColumnStore(storageKey: string): SideColumnStore {
  let collapsed = (() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  })();
  let present = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const setCollapsed = (next: boolean) => {
    if (next === collapsed) return;
    collapsed = next;
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* private mode or quota: the session still works */
    }
    emit();
  };
  return {
    useCollapsed: () => useSyncExternalStore(subscribe, () => collapsed, () => collapsed),
    usePresent: () => useSyncExternalStore(subscribe, () => present > 0, () => false),
    useRegister: (active = true) => {
      useEffect(() => {
        if (!active) return;
        present += 1;
        emit();
        return () => {
          present -= 1;
          emit();
        };
      }, [active]);
    },
    isPresent: () => present > 0,
    setCollapsed,
    toggle: () => setCollapsed(!collapsed),
  };
}
