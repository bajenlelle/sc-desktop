import { IS_MACOS } from "@/lib/platform";

/**
 * With the overlay title bar nothing is draggable unless it says so. Every
 * screen that renders outside the shell (auth, onboarding, the crash
 * fallback) mounts this strip so the window can still be moved from it;
 * inside the shell the sidebar's top and the toolbar carry the attribute.
 * Tauri starts the drag only when the event target itself has the
 * attribute, so this element must stay childless.
 */
export function WindowDragStrip() {
  if (!IS_MACOS) return null;
  return (
    <div
      data-tauri-drag-region
      aria-hidden
      className="fixed inset-x-0 top-0 z-30 h-[var(--titlebar-inset)]"
    />
  );
}
