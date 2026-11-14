import { useCallback, useEffect, useMemo } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { PickableGame } from "@scoutable/shared/lib/game-picker";
import { setGameTabsShown } from "@/components/menu-handler";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { forgetGameTab, gameTabsScope, neighbourGameTab, reorderGameTabs, useGameTabs } from "@/lib/game-tabs";
import { IS_MACOS } from "@/lib/platform";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";
import { GameTabPicker } from "./game-tab-picker";
import { GameTabStrip } from "./game-tab-strip";

/**
 * The game page's tab bar: the open games, from two of them, as the top row
 * of the content column, above the game's own toolbar. Everything under it
 * belongs to the shown game.
 *
 * It lives in the window's layout (components/root-layout.tsx), not in the
 * game page: the page is built again each time the game in the address
 * changes, and a bar built with it couldn't keep hold of a tab that was
 * pressed and is now being dragged. It shows only on the game page, and it
 * is where the tabs' keys and the File menu's Close Tab are answered.
 */
export function GameTabBar() {
  const matchId = useMatch("/matches/:id")?.params.id ?? null;
  const navigate = useNavigate();
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const tabs = useGameTabs(scope);
  const collapsed = useSidebarCollapsed();
  const tabCount = tabs.tabs.length;
  const shown = matchId !== null && tabCount >= 2;
  const openIds = useMemo(() => new Set(tabs.tabs.map((t) => t.id)), [tabs.tabs]);

  // A switch blurs the field being typed in first: Details saves on blur, and the page is gone after `navigate`.
  const goTo = useCallback(
    (id: string, via: "tab" | "key" | "menu" | "picker") => {
      (document.activeElement as HTMLElement | null)?.blur();
      // A switch replaces the entry: Back leaves the games, it doesn't step through them.
      navigate(`/matches/${id}`, { replace: true, state: { via: "tab" } });
      trackEvent("game_tab_switched", { via, tabs: tabCount });
    },
    [navigate, tabCount],
  );

  const close = useCallback(
    (id: string, via: "button" | "middle_click" | "menu") => {
      const open = tabs.tabs.some((t) => t.id === id);
      const next = forgetGameTab(scope, id);
      trackEvent("game_tab_closed", { via, tabs: open ? tabs.tabs.length - 1 : tabs.tabs.length });
      if (id === matchId && next) {
        (document.activeElement as HTMLElement | null)?.blur();
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
      (document.activeElement as HTMLElement | null)?.blur();
      navigate(`/matches/${game.id}`, { replace: true, state: { via: "picker" } });
    },
    [matchId, goTo, navigate],
  );

  // ⌘W closes the tab while there are tabs, and the window otherwise (src-tauri/src/menu.rs).
  useEffect(() => {
    setGameTabsShown(shown);
  }, [shown]);
  useEffect(() => () => setGameTabsShown(false), []);

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
      if (shown) close(matchId, "menu");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("menu-game-tab", onStep);
    window.addEventListener("menu-close-game-tab", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("menu-game-tab", onStep);
      window.removeEventListener("menu-close-game-tab", onClose);
    };
  }, [scope, matchId, shown, goTo, close]);

  if (!shown || !matchId) return null;
  return (
    // The row drags the window wherever a tab or the + isn't. The line along its foot is broken by the shown
    // game's tab, which is the page's own colour. With the sidebar hidden on macOS the traffic lights sit here.
    <div
      data-tauri-drag-region
      className={cn(
        "relative z-20 flex h-11 shrink-0 items-end bg-fill-1 pr-4 shadow-[inset_0_-1px_0_var(--separator)] select-none",
        IS_MACOS && collapsed ? "pl-[calc(var(--traffic-lights-width)+0.75rem)]" : "pl-3",
      )}
    >
      <GameTabStrip
        tabs={tabs.tabs}
        activeId={matchId}
        onSelect={(id) => goTo(id, "tab")}
        onClose={close}
        onReorder={(order) => reorderGameTabs(scope, order)}
        onReordered={() => trackEvent("game_tabs_reordered", { tabs: tabCount })}
      />
      <GameTabPicker orgId={activeOrgId} openIds={openIds} onPick={pick} />
    </div>
  );
}
