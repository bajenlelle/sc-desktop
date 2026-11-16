import { useCallback, useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { PickableGame } from "@scoutable/shared/lib/game-picker";
import { setGameTabsShown, setReopenGameTabEnabled } from "@/components/menu-handler";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  announceClosedGameTab,
  closeOtherGameTabs,
  forgetGameTab,
  gameTabsScope,
  neighbourGameTab,
  reopenClosedGameTab,
  reorderGameTabs,
  useGameTabs,
  useHasClosedGameTab,
} from "@/lib/game-tabs";
import { IS_MACOS } from "@/lib/platform";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";
import { GameTabPicker } from "./game-tab-picker";
import { GameTabStrip } from "./game-tab-strip";

/**
 * The game page's tab bar: the open games as the top row of the content
 * column, above the game's own toolbar. Everything under it belongs to the
 * shown game. It is there with one game too: the + after the tab is how
 * another game is opened beside it, and a way in that only shows once there
 * are two tabs is not found (⌘T and the File menu were the only ones).
 *
 * It lives in the window's layout (components/root-layout.tsx), not in the
 * game page: the page is built again each time the game in the address
 * changes, and a bar built with it couldn't keep hold of a tab that was
 * pressed and is now being dragged. It shows only on the game page, and it
 * is where the tabs' keys and the File menu's New Tab, Close Tab and Reopen
 * Closed Tab are answered.
 */
/**
 * Before a switch: the field being typed in is left, since Details saves on blur and the page is gone after
 * `navigate`. A tab keeps the focus: the keyboard chose it, and goes on from it.
 */
function leaveField() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.getAttribute("role") !== "tab") focused.blur();
}

export function GameTabBar() {
  const matchId = useMatch("/matches/:id")?.params.id ?? null;
  const navigate = useNavigate();
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const tabs = useGameTabs(scope);
  const collapsed = useSidebarCollapsed();
  const tabCount = tabs.tabs.length;
  const hasClosed = useHasClosedGameTab(scope);
  const [picking, setPicking] = useState(false);
  // Tabs to close: from two. With one, ⌘W is the window's and the tab has no ×.
  const tabbed = matchId !== null && tabCount >= 2;
  const openIds = useMemo(() => new Set(tabs.tabs.map((t) => t.id)), [tabs.tabs]);

  const goTo = useCallback(
    (id: string, via: "tab" | "key" | "menu" | "picker") => {
      leaveField();
      // A switch replaces the entry: Back leaves the games, it doesn't step through them.
      navigate(`/matches/${id}`, { replace: true, state: { via: "tab" } });
      trackEvent("game_tab_switched", { via, tabs: tabCount });
    },
    [navigate, tabCount],
  );

  const close = useCallback(
    (id: string, via: "button" | "middle_click" | "menu" | "key" | "tab_menu") => {
      // A lone tab stays: there is no other game to give the page to.
      if (tabs.tabs.length < 2 || !tabs.tabs.some((t) => t.id === id)) return;
      const next = forgetGameTab(scope, id);
      trackEvent("game_tab_closed", { via, tabs: tabs.tabs.length - 1 });
      if (id === matchId && next) {
        leaveField();
        navigate(`/matches/${next}`, { replace: true, state: { via: "tab" } });
      }
    },
    [tabs, scope, matchId, navigate],
  );

  /** The picker's choice: a game with a tab goes to it; another opens in a new one. */
  const pick = useCallback(
    (game: PickableGame) => {
      if (game.open) {
        if (game.id !== matchId) goTo(game.id, "picker");
        return;
      }
      leaveField();
      navigate(`/matches/${game.id}`, { replace: true, state: { via: "picker" } });
    },
    [matchId, goTo, navigate],
  );

  /** A tab's menu: every other tab closes, and the one kept is the game shown. */
  const closeOthers = useCallback(
    (keepId: string) => {
      closeOtherGameTabs(scope, keepId);
      trackEvent("game_tab_closed", { via: "close_others", tabs: 1 });
      if (keepId !== matchId) {
        leaveField();
        navigate(`/matches/${keepId}`, { replace: true, state: { via: "tab" } });
      }
    },
    [scope, matchId, navigate],
  );

  /** Reopen Closed Tab: the tab closed last comes back in its place, as it was left. */
  const reopen = useCallback(() => {
    const back = reopenClosedGameTab(scope);
    if (!back) return;
    trackEvent("game_tab_reopened", { tabs: tabCount + 1 });
    if (back.evicted) announceClosedGameTab(back.evicted.title);
    leaveField();
    navigate(`/matches/${back.id}`, { replace: true, state: { via: "tab" } });
  }, [scope, tabCount, navigate]);

  // ⌘W closes the tab while there are tabs to close, and the window otherwise (src-tauri/src/menu.rs).
  useEffect(() => {
    setGameTabsShown(tabbed);
  }, [tabbed]);
  useEffect(() => () => setGameTabsShown(false), []);
  // Reopen Closed Tab is on while there is one to bring back.
  useEffect(() => {
    setReopenGameTabEnabled(hasClosed);
  }, [hasClosed]);
  useEffect(() => () => setReopenGameTabEnabled(false), []);

  // Reopen Closed Tab works from any page: it goes to the game. New Tab is the game page's.
  useEffect(() => {
    const onNew = () => {
      if (matchId) setPicking(true);
    };
    window.addEventListener("menu-reopen-game-tab", reopen);
    window.addEventListener("menu-new-game-tab", onNew);
    return () => {
      window.removeEventListener("menu-reopen-game-tab", reopen);
      window.removeEventListener("menu-new-game-tab", onNew);
    };
  }, [matchId, reopen]);
  // Leaving the game page closes the picker with it.
  useEffect(() => {
    if (!matchId) setPicking(false);
  }, [matchId]);

  // ⌃Tab and ⌃⇧Tab step through the tabs on every layout; the Window menu's ⌘⇧] and ⌘⇧[ arrive as
  // "menu-game-tab", the File menu's Close Tab as "menu-close-game-tab".
  useEffect(() => {
    if (!matchId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.key !== "Tab") return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      e.preventDefault();
      const next = neighbourGameTab(scope, matchId, e.shiftKey ? -1 : 1);
      if (next) goTo(next, "key");
    };
    const onStep = (e: Event) => {
      const next = neighbourGameTab(scope, matchId, (e as CustomEvent<1 | -1>).detail);
      if (next) goTo(next, "menu");
    };
    const onClose = () => {
      if (!tabbed) return;
      // A dialog is in front (a picker, the tip-off sheet): Close Tab is not for the page behind it.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (tabs.tabs.some((t) => t.id === matchId)) close(matchId, "menu");
      // The page on screen has no tab (its game is gone, or belongs to another space): leave it for the game shown last.
      else if (tabs.recent[0]) goTo(tabs.recent[0], "menu");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("menu-game-tab", onStep);
    window.addEventListener("menu-close-game-tab", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("menu-game-tab", onStep);
      window.removeEventListener("menu-close-game-tab", onClose);
    };
  }, [scope, matchId, tabbed, tabs, goTo, close]);

  if (!matchId) return null;
  return (
    // The row drags the window wherever a tab or the + isn't. The line along its foot is broken by the shown
    // game's tab, which is the page's own colour. With the sidebar hidden on macOS the traffic lights sit here.
    // The first tab starts where the page's content does (the footage, the Now bar and the timeline are 16 px in).
    <div
      data-tauri-drag-region
      className={cn(
        "relative z-20 flex h-11 shrink-0 items-end bg-fill-1 pr-4 shadow-[inset_0_-1px_0_var(--separator)] select-none",
        IS_MACOS && collapsed ? "pl-[calc(var(--traffic-lights-width)+0.75rem)]" : "pl-4",
      )}
    >
      <GameTabStrip
        tabs={tabs.tabs}
        activeId={matchId}
        onSelect={(id) => goTo(id, "tab")}
        onClose={close}
        onCloseOthers={closeOthers}
        onReorder={(order) => reorderGameTabs(scope, order)}
        onReordered={() => trackEvent("game_tabs_reordered", { tabs: tabCount })}
      />
      <GameTabPicker open={picking} onOpenChange={setPicking} orgId={activeOrgId} openIds={openIds} onPick={pick} />
    </div>
  );
}
