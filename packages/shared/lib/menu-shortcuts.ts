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
 * The sidebar's pages as Go menu ids, in the sidebar's order
 * (apps/desktop/src/components/shell/sidebar.tsx draws its rows from this).
 */
export const GO_PAGES = ["go-home", "go-playlists", "go-reports", "go-my-playlists", "go-library"] as const;
export type GoPage = (typeof GO_PAGES)[number];

/** Who the sidebar is drawn for: a coach or admin of the space (`staff`), and whether the space is a personal one. */
export interface SidebarFor {
  staff: boolean;
  personal: boolean;
}

/**
 * The rows the sidebar shows, top to bottom. Home, Playlists, Reports and the
 * Library are the staff's; the playlists shared in a club ("Shared playlists"
 * to its staff, "My playlists" to a player) are there in a club space only.
 */
export function sidebarPages(who: SidebarFor): GoPage[] {
  return GO_PAGES.filter((id) => (id === "go-my-playlists" ? !who.personal : who.staff));
}

/**
 * Which page each number key opens, first key first: ⌘ or Ctrl with n is the
 * nth row the sidebar shows. The pages it doesn't show take the keys after
 * the rows, so every page always has a key of its own: the native menu can
 * move an item's key but not take it away, and two items must never share one.
 * Those pages are off, so their keys do nothing.
 */
export function goKeyOrder(who: SidebarFor): GoPage[] {
  const shown = sidebarPages(who);
  return [...shown, ...GO_PAGES.filter((id) => !shown.includes(id))];
}

/**
 * Unshifted CmdOrCtrl chords → menu item id. The Shift chords
 * (fullscreen-player on F, the game tabs on [ and ], reopening a closed game
 * tab on T) and the number keys (the sidebar's rows) are in menuIdForChord.
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
  // Organization is not a row of the sidebar: its key comes after the rows' (1 to 5), whatever they are.
  "6": "go-organization",
};

/**
 * `pages`: which page each number key opens (`goKeyOrder` for whoever the
 * sidebar is drawn for); every row shown when not given.
 */
export function menuIdForChord(e: KeyChord, pages: readonly GoPage[] = GO_PAGES): string | null {
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
  // The nth row of the sidebar.
  if (key.length === 1 && key >= "1" && key <= "5") return pages[Number(key) - 1] ?? null;
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
