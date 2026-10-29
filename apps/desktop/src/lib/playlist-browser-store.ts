/**
 * The playlist browser's shown/hidden state, the Playlists page's second
 * sidebar: a tiny external store like sidebar-store.ts, so the toolbar's
 * toggle, the View menu and the page agree without a provider, persisted per
 * machine. `present` says the page with the browser is mounted, which is
 * when the toolbar shows the toggle.
 */
import { useEffect, useSyncExternalStore } from "react";

const KEY = "scoutable_playlist_browser_collapsed";

let collapsed = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
let present = 0;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export function useBrowserCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => collapsed, () => collapsed);
}

/** The Playlists page, with its browser, is on screen. */
export function useBrowserPresent(): boolean {
  return useSyncExternalStore(subscribe, () => present > 0, () => false);
}

/** Called by the page that holds the browser, for as long as it is mounted. */
export function useRegisterBrowser() {
  useEffect(() => {
    present += 1;
    emit();
    return () => {
      present -= 1;
      emit();
    };
  }, []);
}

export function setBrowserCollapsed(next: boolean) {
  if (next === collapsed) return;
  collapsed = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* private mode or quota: the session still works */
  }
  emit();
}

export function toggleBrowser() {
  setBrowserCollapsed(!collapsed);
}
