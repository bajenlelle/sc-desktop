/**
 * Mirrors native window state onto <html> so CSS can follow it:
 *
 * - `data-window-inactive`: selection and sidebar text dim when the window
 *   is not key, like every macOS source list.
 * - `data-window-fullscreen`: in native fullscreen the system hides the
 *   traffic lights, so the title-bar inset collapses to zero.
 *
 * Tauri has no fullscreen event (the player's own hook polls for the same
 * reason), but the window resizes on the way in and out, so a debounced
 * `isFullscreen()` after each resize stays cheap and correct.
 */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MACOS } from "@/lib/platform";

export function WindowChromeEffects() {
  useEffect(() => {
    if (!IS_MACOS) return;
    const win = getCurrentWindow();
    const root = document.documentElement;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    let resizeTimer: number | undefined;

    async function syncFullscreen() {
      try {
        const fullscreen = await win.isFullscreen();
        if (!disposed) root.dataset.windowFullscreen = fullscreen ? "true" : "false";
      } catch {
        /* permission or window gone; CSS keeps its defaults */
      }
    }
    async function syncFocus() {
      try {
        const focused = await win.isFocused();
        if (!disposed) root.dataset.windowInactive = focused ? "false" : "true";
      } catch {
        /* ignore */
      }
    }

    void syncFullscreen();
    void syncFocus();

    win
      .onFocusChanged(({ payload: focused }) => {
        root.dataset.windowInactive = focused ? "false" : "true";
      })
      .then((fn) => (disposed ? fn() : unlisteners.push(fn)))
      .catch(() => {});
    win
      .onResized(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => void syncFullscreen(), 120);
      })
      .then((fn) => (disposed ? fn() : unlisteners.push(fn)))
      .catch(() => {});

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      for (const fn of unlisteners) fn();
    };
  }, []);

  return null;
}
