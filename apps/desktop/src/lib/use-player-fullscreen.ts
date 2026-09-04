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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
        if (!isFs) setActive(false);
      } catch {
        // ignore — next tick retries
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [active]);

  return { active, enter, exit, toggle };
}

/**
 * Auto-hiding chrome for fullscreen playback (the Video.js "userActive"
 * pattern): visible on any activity, fades after `timeoutMs` idle. Callers
 * force visibility while paused / hovering chrome / mid-drag via `pin`.
 */
export function useIdleControls(active: boolean, timeoutMs = 2500) {
  const [visible, setVisible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const timerRef = useRef<number | null>(null);

  const poke = useCallback(() => {
    setVisible(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setVisible(false), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    if (!active) {
      setVisible(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    poke();
    const onActivity = () => poke();
    document.addEventListener("mousemove", onActivity);
    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);
    return () => {
      document.removeEventListener("mousemove", onActivity);
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("keydown", onActivity);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [active, poke]);

  return { visible: visible || pinned, setPinned };
}
