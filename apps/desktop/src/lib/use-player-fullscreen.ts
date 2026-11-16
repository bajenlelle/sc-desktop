/**
 * Fullscreen state for the playlist player, backed by NATIVE window
 * fullscreen — the DOM Fullscreen API is unreliable in Tauri/WKWebView
 * (tauri#4748/#14227, both closed "not planned"), and WebKit's video-element
 * path would inject native controls over our custom chrome.
 *
 * macOS reserves Esc to exit native fullscreen and Tauri has no
 * fullscreen-change event yet (tauri#7162), so while active we POLL
 * isFullscreen(): if the OS dropped it (Esc, green button, Mission
 * Control), the CSS layer exits too instead of stranding a windowed app
 * behind a fixed black overlay.
 *
 * If the window was ALREADY fullscreen when the player entered (user lives
 * in ⌃⌘F fullscreen), exiting the player leaves the window as it was.
 *
 * A window that leaves native fullscreen on macOS keeps the keyboard for
 * itself: the page is no longer the one keys go to, so Space, the arrows and
 * F did nothing until a click. Once the window is out, the page takes the
 * keyboard back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Gives the page the keyboard again after the window has left native
 * fullscreen. The window lets go of the page some half a second into its
 * animation out, and says it has left long before that, so there is no moment
 * to wait for: for two and a half seconds, whenever the page is found without
 * the keyboard, it is asked back.
 */
async function returnKeyboardToPage(): Promise<void> {
  try {
    const webview = getCurrentWebview();
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!document.hasFocus()) await webview.setFocus();
    }
  } catch {
    // Best-effort: a click in the window does the same.
  }
}

export function usePlayerFullscreen() {
  const [active, setActive] = useState(false);
  const wasWindowFullscreenRef = useRef(false);

  const enter = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      wasWindowFullscreenRef.current = await win.isFullscreen();
      if (!wasWindowFullscreenRef.current) await win.setFullscreen(true);
    } catch {
      // Window API failure (permission/dev quirk): the fixed-layer
      // "fullscreen" still works inside the window — don't block it.
    }
    setActive(true);
  }, []);

  const exit = useCallback(async () => {
    setActive(false);
    if (!wasWindowFullscreenRef.current) {
      try {
        await getCurrentWindow().setFullscreen(false);
      } catch {
        // Best-effort: worst case the user un-fullscreens natively.
      }
      void returnKeyboardToPage();
    }
  }, []);

  const toggle = useCallback(() => {
    if (active) void exit();
    else void enter();
  }, [active, enter, exit]);

  // Resync: the OS can exit native fullscreen without asking us.
  useEffect(() => {
    if (!active || wasWindowFullscreenRef.current) return;
    const id = window.setInterval(async () => {
      try {
        const isFs = await getCurrentWindow().isFullscreen();
        if (!isFs) {
          setActive(false);
          void returnKeyboardToPage();
        }
      } catch {
        // ignore — next tick retries
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [active]);

  return { active, enter, exit, toggle };
}
