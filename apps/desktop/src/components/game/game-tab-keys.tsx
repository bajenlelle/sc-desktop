import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { setCloseTabInMenu, setGameTabStepEnabled, setNewGameTabEnabled, setReopenGameTabEnabled } from "@/components/menu-handler";
import { useRouteGate } from "@/components/protected-route";
import { neighbourGameTab, useHasClosedGameTab } from "@/lib/game-tabs";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar-store";
import { gameOnScreen, setGamePickerOpen, setHeadingToGame, useGameTabActions } from "./use-game-tab-actions";

/** What the Window menu was last told, so an unchanged list isn't sent again. */
let windowMenuSent: string | undefined;

type WindowMenuGame = { id: string; title: string; shown: boolean };
function sendWindowMenu(games: WindowMenuGame[], force = false) {
  const sent = JSON.stringify(games);
  if (!force && windowMenuSent === sent) return;
  windowMenuSent = sent;
  invoke("menu_open_games", { games }).catch(() => {});
}

/**
 * The open games' keys and menu items, from any page (it draws nothing; the games are the sidebar's rows,
 * components/shell/open-games.tsx). Lives in the window's layout, so it answers wherever the coach is:
 *
 * - ⌃Tab and ⌃⇧Tab, and the Window menu's Show Next/Previous Game Tab (⌘⇧] ⌘⇧[): on the game page they step
 *   through the open games and wrap; from any other page they go back to the game shown last.
 * - The Window menu lists the open games, the one on screen checked, as a Mac app lists its documents.
 * - New Tab (⌘T) opens the game picker: at the sidebar's +, or with the sidebar hidden at the game's title
 *   (and off the game page the sidebar is shown for it). Reopen Closed Tab (⇧⌘T) brings back the tab closed
 *   last, from any page.
 * - Close Tab (⌘W) closes the game on screen while there is another to go to; otherwise ⌘W closes the window.
 */
export function GameTabKeys() {
  const { matchId, scope, tabs, goTo, close, reopen } = useGameTabActions();
  const gate = useRouteGate();
  const collapsed = useSidebarCollapsed();
  const hasClosed = useHasClosedGameTab(scope);
  const onGame = matchId !== null;
  const tabCount = tabs.tabs.length;
  const live = gate === "app";
  // A switch has landed (or the coach went elsewhere): the sidebar selects by the address again.
  const { key: locationKey } = useLocation();
  useEffect(() => {
    setHeadingToGame(null);
  }, [locationKey]);
  // ⌘W closes the game's tab while there is another game to go to (src-tauri/src/menu.rs).
  const tabbed = live && onGame && tabCount >= 2;

  useEffect(() => {
    setCloseTabInMenu(tabbed);
  }, [tabbed]);
  useEffect(() => {
    setReopenGameTabEnabled(live && hasClosed);
  }, [live, hasClosed]);
  // Somewhere to step to: another game on the game page, any open game from elsewhere.
  useEffect(() => {
    setGameTabStepEnabled(live && (onGame ? tabCount >= 2 : tabCount >= 1));
  }, [live, onGame, tabCount]);
  // The picker opens where the open games are (the sidebar's +), or at the game's title.
  useEffect(() => {
    setNewGameTabEnabled(live && (onGame || tabCount >= 1));
  }, [live, onGame, tabCount]);

  // The Window menu's list of open games.
  const windowGames: WindowMenuGame[] = live ? tabs.tabs.map((t) => ({ id: t.id, title: t.title || "Game", shown: t.id === matchId })) : [];
  const windowKey = JSON.stringify(windowGames);
  useEffect(() => {
    sendWindowMenu(JSON.parse(windowKey) as WindowMenuGame[]);
  }, [windowKey]);

  // Leaving for a page with no picker to show closes it.
  useEffect(() => {
    if (!onGame && tabCount === 0) setGamePickerOpen(false);
  }, [onGame, tabCount]);

  useEffect(() => {
    if (!live) return;
    const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"]');
    /** One step through the open games; from another page, back to the game shown last. */
    const step = (dir: 1 | -1, via: "key" | "menu") => {
      const current = gameOnScreen();
      const next = current ? neighbourGameTab(scope, current, dir) : (tabs.recent[0] ?? null);
      if (next) goTo(next, via);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.key !== "Tab") return;
      if (dialogOpen()) return;
      if (!gameOnScreen() && tabCount === 0) return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1, "key");
    };
    const onStep = (e: Event) => step((e as CustomEvent<1 | -1>).detail, "menu");
    const onClose = () => {
      if (!tabbed || !matchId) return;
      // A dialog is in front (a picker, the tip-off sheet): Close Tab is not for the page behind it.
      if (dialogOpen()) return;
      if (tabs.tabs.some((t) => t.id === matchId)) close(matchId, "menu");
      // The page on screen has no tab (its game is gone, or belongs to another space): leave it for the game shown last.
      else if (tabs.recent[0]) goTo(tabs.recent[0], "menu");
    };
    const onNew = () => {
      if (!matchId && tabCount === 0) return;
      // Off the game page the picker is the sidebar's: it is shown for it.
      if (collapsed && !matchId) setSidebarCollapsed(false);
      setGamePickerOpen(true);
    };
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      goTo(id, "window_menu");
      // Choosing the game on screen flips its check off natively, and nothing else changes: tell the menu again.
      if (id === matchId) sendWindowMenu(JSON.parse(windowKey) as WindowMenuGame[], true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("menu-game-tab", onStep);
    window.addEventListener("menu-close-game-tab", onClose);
    window.addEventListener("menu-new-game-tab", onNew);
    window.addEventListener("menu-reopen-game-tab", reopen);
    window.addEventListener("menu-open-game", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("menu-game-tab", onStep);
      window.removeEventListener("menu-close-game-tab", onClose);
      window.removeEventListener("menu-new-game-tab", onNew);
      window.removeEventListener("menu-reopen-game-tab", reopen);
      window.removeEventListener("menu-open-game", onOpen);
    };
  }, [live, matchId, scope, tabs, tabCount, tabbed, collapsed, windowKey, goTo, close, reopen]);

  return null;
}
