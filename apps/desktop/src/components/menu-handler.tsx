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
import { useTheme } from "next-themes";
import { isBrowserShortcut, menuIdForChord } from "@scoutable/shared/lib/menu-shortcuts";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { interactiveUpdateCheck } from "@/lib/updates";

const ZOOM_KEY = "scoutable_zoom";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/**
 * macOS owns the accelerators through the native menu; a keydown listener
 * there would run every action twice. The UA is the one platform signal the
 * webview has without a round-trip, and WKWebView always carries "Macintosh".
 */
const HAS_NATIVE_MENU = navigator.userAgent.includes("Macintosh");

/** Items only coaches/admins can use (mirrors app-sidebar gating). */
const COACH_ADMIN_IDS = ["new-playlist", "add-game", "go-home", "go-playlists", "go-library"];

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

export function MenuHandler() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, activeOrgRole, activeOrgIsPersonal, activeOrgCanManage } = useAuth();
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
      switch (id) {
        case "settings":
          navigate("/settings");
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
        case "go-my-playlists":
          navigate("/my-playlists");
          break;
        case "go-library":
          navigate("/matches");
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
        case "toggle-playlist-browser":
          window.dispatchEvent(new CustomEvent("playlist-browser-toggle"));
          break;
        case "fullscreen-player":
          window.dispatchEvent(new CustomEvent("player-fullscreen-toggle"));
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
      const id = menuIdForChord(e);
      // Unknown ids are enabled, like a fresh native item; export-playlist is
      // gated by the playlists page's own listener instead.
      if (!id || enabledIds.get(id) === false) return;
      e.preventDefault();
      runMenuAction(id);
    }

    let unlisten: (() => void) | undefined;
    listen<string>("menu", (event) => runMenuAction(event.payload)).then((fn) => {
      unlisten = fn;
    });
    if (!HAS_NATIVE_MENU) window.addEventListener("keydown", onKeyDown);
    return () => {
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

  useEffect(() => {
    setEnabled("toggle-playlist-browser", pathname === "/playlists");
    setEnabled("fullscreen-player", pathname === "/playlists");
    // Export is enabled by pages/playlists.tsx while a playlist is open;
    // everywhere else it must be off. On the page itself the mirror must not
    // keep a stale "off" — the page decides, through its own listener.
    if (pathname !== "/playlists") setEnabled("export-playlist", false);
    else enabledIds.delete("export-playlist");
  }, [pathname]);

  useEffect(() => {
    invoke("menu_sync_theme", { theme: theme ?? "dark" }).catch(() => {});
  }, [theme]);

  return null;
}
