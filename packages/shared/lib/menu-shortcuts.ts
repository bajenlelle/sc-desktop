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

/**
 * Unshifted CmdOrCtrl chords → menu item id. The Shift chords
 * (fullscreen-player on F, the game tabs on [ and ], reopening a closed game
 * tab on T) are in menuIdForChord.
 */
const PLAIN: Record<string, string> = {
  ",": "settings",
  n: "new-playlist",
  o: "add-game",
  e: "export-playlist",
  b: "toggle-playlist-browser",
  // On only while the game page has two tabs or more (a tab to close to); elsewhere the chord is left alone.
  w: "close-tab",
  // The game page's tab picker; on only on the game page.
  t: "new-game-tab",
  // The search over the space (docs/search.md); the same chord closes it.
  k: "search",
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
  // Shift chords: fullscreen-player, a closed game tab back, and the game tabs on Shift with [ or ].
  // Shift turns [ and ] into { and } on US layouts, so either is accepted.
  if (e.shiftKey) {
    if (key === "f") return "fullscreen-player";
    if (key === "t") return "reopen-game-tab";
    if (key === "[" || key === "{") return "game-tab-prev";
    if (key === "]" || key === "}") return "game-tab-next";
    return null;
  }
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
