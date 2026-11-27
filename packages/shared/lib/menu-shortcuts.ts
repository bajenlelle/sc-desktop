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
export const GO_PAGES = ["go-playlists", "go-reports", "go-my-playlists", "go-library", "go-teams", "go-highlights"] as const;
export type GoPage = (typeof GO_PAGES)[number];

/** Who the sidebar is drawn for: a coach or admin of the space (`staff`), and whether the space is a personal one. */
export interface SidebarFor {
  staff: boolean;
  personal: boolean;
}

/**
 * The rows the sidebar shows, top to bottom. Playlists, Reports, the Library
 * and Teams are the staff's; the playlists shared in a club ("Shared playlists"
 * to its staff, "My playlists" to a player) are there in a club space only, and
 * a player's own Highlights (pages/highlights.tsx) in a personal space only.
 */
export function sidebarPages(who: SidebarFor): GoPage[] {
  return GO_PAGES.filter((id) =>
    id === "go-my-playlists" ? !who.personal : id === "go-highlights" ? who.personal : who.staff,
  );
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
  // On only while the game page has two open games or more (one to close to); elsewhere the chord is left alone.
  w: "close-tab",
  // The open games' picker; on while there is somewhere to show it (the game page, or the sidebar's Open games).
  t: "new-game-tab",
  // The search over the space (docs/search.md); the same chord closes it.
  k: "search",
  // The editor's clip shown in its game (G for Game); on only while the editor has a clip.
  g: "show-clip-in-game",
  "0": "zoom-reset",
  // Organization is not a row of the sidebar: its key comes after the rows' (1 to 6), whatever they are.
  "7": "go-organization",
  // Go > Back and Forward through the pages walked (docs/navigation.md), as Safari's and Finder's.
  "[": "nav-back",
  "]": "nav-forward",
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
  // Shift chords: fullscreen-player, a closed game tab back, the game tabs on Shift with [ or ].
  // Shift turns [ and ] into { and } on US layouts, so either is accepted.
  if (e.shiftKey) {
    if (key === "f") return "fullscreen-player";
    if (key === "t") return "reopen-game-tab";
    if (key === "[" || key === "{") return "game-tab-prev";
    if (key === "]" || key === "}") return "game-tab-next";
    return null;
  }
  // The nth row of the sidebar.
  if (key.length === 1 && key >= "1" && key <= String(GO_PAGES.length)) return pages[Number(key) - 1] ?? null;
  return PLAIN[key] ?? null;
}

/**
 * Back and Forward by the arrows, recognised from keydown on every platform (they are no menu's: a menu
 * would take them from text fields, where they move the caret): Cmd+Left and Cmd+Right on a Mac, as Linear
 * offers beside Cmd+[ and Cmd+] for layouts where [ takes Option (Swedish among them); Alt+Left and Alt+Right
 * on Windows, as its browsers and Explorer do. The caller leaves out keys typed into a text field.
 */
export function historyKeyFor(e: KeyChord, mac: boolean): "nav-back" | "nav-forward" | null {
  if (e.shiftKey) return null;
  const chord = mac ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey;
  if (!chord) return null;
  if (e.key === "ArrowLeft") return "nav-back";
  if (e.key === "ArrowRight") return "nav-forward";
  return null;
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
