/**
 * Frontend half of the native macOS menu (src-tauri/src/menu.rs). Listens for
 * the single "menu" event carrying an item id and maps it to an action using
 * the app's existing patterns: navigation via react-router, in-page behavior
 * via DOM CustomEvents, cross-cutting utilities via shared libs. Also keeps
 * menu item enablement and the Appearance checkmarks in sync with app state.
 *
 * Keep the id list in sync with menu.rs. Where there is no native menu
 * (Windows) the same accelerators are recognised here from keydown instead —
 * without that, zoom and every shortcut simply didn't exist on that platform —
 * and the sync invokes hit no-op commands.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
import { whatsNewUrl } from "@scoutable/shared/lib/release-notes";
import { useTheme } from "next-themes";
import { GO_PAGES, goKeyOrder, isBrowserShortcut, menuIdForChord, type GoPage } from "@scoutable/shared/lib/menu-shortcuts";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { interactiveUpdateCheck } from "@/lib/updates";
import { IS_MACOS } from "@/lib/platform";
import { menuAppearanceFor } from "@scoutable/shared/lib/appearance";
import { toggleSidebar, useSidebarCollapsed } from "@/lib/sidebar-store";
import { toggleBrowser, useBrowserCollapsed } from "@/lib/playlist-browser-store";
import { toggleQuickSearch } from "@/lib/quick-search-store";

const ZOOM_KEY = "scoutable_zoom";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/**
 * macOS owns the accelerators through the native menu; a keydown listener
 * there would run every action twice.
 */
const HAS_NATIVE_MENU = IS_MACOS;

/** Items only coaches/admins can use (mirrors the sidebar's gating). */
const COACH_ADMIN_IDS = ["new-playlist", "add-game", "go-home", "go-playlists", "go-reports", "go-library", "go-teams", "search"];

/** Mirror of each item's native enablement, consulted by the keyboard fallback. */
const enabledIds = new Map<string, boolean>();

function storedZoom(): number {
  const raw = Number(localStorage.getItem(ZOOM_KEY));
  return raw >= ZOOM_MIN && raw <= ZOOM_MAX ? raw : 1;
}

function setEnabled(id: string, enabled: boolean) {
  enabledIds.set(id, enabled);
  invoke("menu_set_enabled", { id, enabled }).catch(() => {});
}

// Until the game page has two tabs there is no tab for ⌘W (Ctrl+W) to close.
enabledIds.set("close-tab", false);
/** What the native menu was last told about the tabs; undefined until this page has told it anything. */
let gameTabsShownSent: boolean | undefined;

/**
 * Whether there is a tab to close: the game page has two open games or more (components/game/game-tab-keys.tsx;
 * with one game it is open, but there is no other game to go to). While there is, the File menu has Close Tab
 * on ⌘W and Close Window on ⇧⌘W, as Safari does; otherwise ⌘W closes the window (src-tauri/src/menu.rs swaps
 * the two). Where there is no menu bar the same flag gates Ctrl+W.
 */
export function setCloseTabInMenu(shown: boolean) {
  // The first call after the page loads always goes through: the native menu outlives a reload of the webview,
  // and may still be as the page before it left it. The native side ignores a call that changes nothing.
  if (gameTabsShownSent === shown) return;
  gameTabsShownSent = shown;
  enabledIds.set("close-tab", shown);
  invoke("menu_game_tabs", { shown }).catch(() => {});
}

// Until a tab has been closed there is none to reopen.
enabledIds.set("reopen-game-tab", false);

/** Whether there is a closed game tab for Reopen Closed Tab (⇧⌘T, Ctrl+Shift+T) to bring back. */
export function setReopenGameTabEnabled(enabled: boolean) {
  if (enabledIds.get("reopen-game-tab") === enabled) return;
  setEnabled("reopen-game-tab", enabled);
}

// Until there is an open game there is none to step to or open another beside.
enabledIds.set("game-tab-prev", false);
enabledIds.set("game-tab-next", false);
enabledIds.set("new-game-tab", false);
enabledIds.set("show-clip-in-game", false);

/** Whether Show Next/Previous Game Tab have a game to go to (components/game/game-tab-keys.tsx). */
export function setGameTabStepEnabled(enabled: boolean) {
  if (enabledIds.get("game-tab-next") === enabled) return;
  setEnabled("game-tab-prev", enabled);
  setEnabled("game-tab-next", enabled);
}

/** Whether New Tab has somewhere to open its picker: the game page, or the sidebar's Open games. */
export function setNewGameTabEnabled(enabled: boolean) {
  if (enabledIds.get("new-game-tab") === enabled) return;
  setEnabled("new-game-tab", enabled);
}

/** Whether the editor has a clip to show in its game (Go > Show Clip in Game; pages/playlists.tsx). */
export function setShowClipInGameEnabled(enabled: boolean) {
  if (enabledIds.get("show-clip-in-game") === enabled) return;
  setEnabled("show-clip-in-game", enabled);
}

/** Which page each number key opens now (`goKeyOrder`): ⌘ or Ctrl with n is the nth row the sidebar shows. */
let goKeys: readonly GoPage[] = GO_PAGES;
/** What the native menu was last told; undefined until this page has told it anything (it outlives a reload). */
let goKeysSent: string | undefined;

/** The sidebar shows these rows now: the keyboard fallback reads the order, and the native menu moves its keys. */
function setGoKeys(order: readonly GoPage[]) {
  goKeys = order;
  const sent = order.join(",");
  if (goKeysSent === sent) return;
  goKeysSent = sent;
  invoke("menu_set_go_keys", { order }).catch(() => {});
}

/** A Show/Hide item says what it will do, so its title follows the panel. */
function setText(id: string, text: string) {
  invoke("menu_set_text", { id, text }).catch(() => {});
}

export function MenuHandler() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, activeOrgId, activeOrgRole, activeOrgIsPersonal, activeOrgCanManage, profileLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const zoomRef = useRef(storedZoom());

  // Zoom is a webview-level factor; re-apply the persisted value on startup.
  useEffect(() => {
    if (zoomRef.current !== 1) {
      getCurrentWebview().setZoom(zoomRef.current).catch(() => {});
    }
  }, []);

  useEffect(() => {
    function applyZoom(next: number) {
      const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 10) / 10));
      zoomRef.current = clamped;
      localStorage.setItem(ZOOM_KEY, String(clamped));
      getCurrentWebview().setZoom(clamped).catch(() => {});
    }

    async function signOut() {
      const supabase = createClient();
      await supabase.auth.signOut({ scope: "local" });
      navigate("/auth/login");
    }

    function runMenuAction(id: string) {
      // The Window menu's open games: "open-game:<id>".
      if (id.startsWith("open-game:")) {
        window.dispatchEvent(new CustomEvent("menu-open-game", { detail: id.slice("open-game:".length) }));
        return;
      }
      switch (id) {
        case "settings":
          navigate("/settings");
          break;
        // The search over the space: ⌘K, Ctrl+K or Go > Search…. The chord also closes it.
        case "search":
          toggleQuickSearch("shortcut");
          break;
        case "add-game":
          navigate("/upload");
          break;
        case "go-home":
          navigate("/");
          break;
        case "go-playlists":
          navigate("/playlists");
          break;
        case "go-reports":
          navigate("/reports");
          break;
        case "go-my-playlists":
          navigate("/my-playlists");
          break;
        case "go-library":
          navigate("/matches");
          break;
        case "go-teams":
          navigate("/teams");
          break;
        case "go-organization":
          navigate("/organization");
          break;
        case "new-playlist":
          // One-shot flag consumed (and cleared) by pages/playlists.tsx.
          navigate("/playlists", { state: { createNew: true } });
          break;
        case "export-playlist":
          window.dispatchEvent(new CustomEvent("menu-export-playlist"));
          break;
        case "toggle-sidebar":
          toggleSidebar();
          break;
        case "toggle-playlist-browser":
          toggleBrowser();
          break;
        case "fullscreen-player":
          window.dispatchEvent(new CustomEvent("player-fullscreen-toggle"));
          break;
        case "game-tab-prev":
          window.dispatchEvent(new CustomEvent("menu-game-tab", { detail: -1 }));
          break;
        case "game-tab-next":
          window.dispatchEvent(new CustomEvent("menu-game-tab", { detail: 1 }));
          break;
        case "close-tab":
          window.dispatchEvent(new CustomEvent("menu-close-game-tab"));
          break;
        case "new-game-tab":
          window.dispatchEvent(new CustomEvent("menu-new-game-tab"));
          break;
        case "reopen-game-tab":
          window.dispatchEvent(new CustomEvent("menu-reopen-game-tab"));
          break;
        case "show-clip-in-game":
          window.dispatchEvent(new CustomEvent("menu-show-clip-in-game"));
          break;
        case "send-feedback":
          window.dispatchEvent(new CustomEvent("menu-send-feedback"));
          break;
        case "check-updates":
          void interactiveUpdateCheck();
          break;
        case "appearance-light":
          setTheme("light");
          break;
        case "appearance-dark":
          setTheme("dark");
          break;
        case "appearance-system":
          setTheme("system");
          break;
        case "sign-out":
          void signOut();
          break;
        case "whats-new":
          void openUrl(whatsNewUrl("help_menu"));
          break;
        case "open-website":
          void openUrl("https://scoutable.se");
          break;
        case "zoom-in":
          applyZoom(zoomRef.current + ZOOM_STEP);
          break;
        case "zoom-out":
          applyZoom(zoomRef.current - ZOOM_STEP);
          break;
        case "zoom-reset":
          applyZoom(1);
          break;
        default:
          break; // ids handled natively or added in a newer release
      }
    }

    // Keyboard fallback for platforms without the native menu.
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      // WebView2's own F5 / Ctrl+R / Ctrl+P would reload or print the app.
      if (isBrowserShortcut(e)) {
        e.preventDefault();
        return;
      }
      const id = menuIdForChord(e, goKeys);
      // Unknown ids are enabled, like a fresh native item; export-playlist is
      // gated by the playlists page's own listener instead.
      if (!id || enabledIds.get(id) === false) return;
      e.preventDefault();
      // A held chord opens the search once: its repeats would close it and open it again.
      if (e.repeat && id === "search") return;
      runMenuAction(id);
    }

    // listen() resolves asynchronously. If the effect is torn down first
    // (StrictMode's dev double-mount, or a dependency change) there is nothing
    // to unlisten yet, so the first listener leaks and every menu action —
    // zoom most visibly — runs twice.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>("menu", (event) => runMenuAction(event.payload)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    if (!HAS_NATIVE_MENU) window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigate, setTheme]);

  // Role/route gating — items are disabled, never removed (macOS convention).
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  useEffect(() => {
    for (const id of COACH_ADMIN_IDS) setEnabled(id, isCoachOrAdmin);
    setEnabled("go-my-playlists", !!user && !activeOrgIsPersonal);
    // Club staff only — role alone would enable it in personal spaces, where
    // there is no organization to manage.
    setEnabled("go-organization", activeOrgCanManage);
    setEnabled("sign-out", !!user);
  }, [user, isCoachOrAdmin, activeOrgIsPersonal, activeOrgCanManage]);

  // The number keys follow the sidebar: ⌘n (Ctrl+n) opens its nth row. Told once the space and the role
  // are known, so the keys don't pass through a sidebar nobody sees on the way.
  useEffect(() => {
    if (!user || profileLoading || !activeOrgId) return;
    setGoKeys(goKeyOrder({ staff: isCoachOrAdmin, personal: activeOrgIsPersonal }));
  }, [user, profileLoading, activeOrgId, isCoachOrAdmin, activeOrgIsPersonal]);

  useEffect(() => {
    const onGame = /^\/matches\/[^/]+$/.test(pathname);
    setEnabled("toggle-playlist-browser", pathname === "/playlists");
    // Every player: the editor, the watch view of a shared playlist, and the game view.
    setEnabled("fullscreen-player", pathname === "/playlists" || pathname === "/my-playlists" || onGame);
    // The open games' items follow the games themselves (components/game/game-tab-keys.tsx); Show Clip in Game
    // is the editor's to turn on while it has a clip, and off everywhere else.
    if (pathname !== "/playlists") setShowClipInGameEnabled(false);
    // Export is enabled by pages/playlists.tsx while a playlist is open;
    // everywhere else it must be off. On the page itself the mirror must not
    // keep a stale "off" — the page decides, through its own listener.
    if (pathname !== "/playlists") setEnabled("export-playlist", false);
    else enabledIds.delete("export-playlist");
  }, [pathname]);

  const sidebarCollapsed = useSidebarCollapsed();
  const browserCollapsed = useBrowserCollapsed();
  useEffect(() => {
    setText("toggle-sidebar", sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar");
  }, [sidebarCollapsed]);
  useEffect(() => {
    setText("toggle-playlist-browser", browserCollapsed ? "Show Playlists" : "Hide Playlists");
  }, [browserCollapsed]);

  useEffect(() => {
    invoke("menu_sync_theme", { theme: menuAppearanceFor(theme) }).catch(() => {});
  }, [theme]);

  return null;
}
