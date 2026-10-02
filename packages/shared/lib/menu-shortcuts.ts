/**
 * Keyboard accelerators for the native menu's custom items, for platforms
 * without that menu.
 *
 * src-tauri/src/menu.rs declares each item's `CmdOrCtrl+…` accelerator and
 * macOS fires it natively. On Windows there is no menu bar at all, so the
 * webview has to recognise the same chords itself and raise the same ids.
 * Keep the table in sync with menu.rs.
 */
export interface KeyChord {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Unshifted CmdOrCtrl chords → menu item id. */
const PLAIN: Record<string, string> = {
  ",": "settings",
  n: "new-playlist",
  o: "add-game",
  e: "export-playlist",
  b: "toggle-playlist-browser",
  "0": "zoom-reset",
  "1": "go-home",
  "2": "go-playlists",
  "3": "go-my-playlists",
  "4": "go-library",
  "5": "go-organization",
};

export function menuIdForChord(e: KeyChord): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  // Zoom tolerates Shift: on Swedish and German layouts "=" is Shift+0, and
  // "+" is the unshifted key people reach for anyway.
  if (key === "=" || key === "+") return "zoom-in";
  if (key === "-") return "zoom-out";
  if (e.shiftKey) return key === "f" ? "fullscreen-player" : null;
  return PLAIN[key] ?? null;
}

/**
 * Browser-chrome keys WebView2 leaves enabled and the app never wants:
 * F5 / Ctrl+R reload the page (killing an export's progress UI), Ctrl+P
 * prints it. WKWebView has none of these, so this is only consulted where
 * there is no native menu.
 */
export function isBrowserShortcut(e: KeyChord): boolean {
  if (e.key === "F5") return true;
  if (!e.ctrlKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  return key === "r" || key === "p";
}
