import { useCallback, useSyncExternalStore } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { PickableGame } from "@scoutable/shared/lib/game-picker";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  closeOtherGameTabs,
  forgetGameTab,
  gameTabsScope,
  reopenClosedGameTab,
  useGameTabs,
} from "@/lib/game-tabs";

/**
 * Before a switch: the field being typed in is left, since Details saves on blur and the page is gone after
 * `navigate`. A row of the sidebar's open games or teams keeps the focus: the keyboard chose it, and goes on from it.
 */
export function leaveField() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && !focused.hasAttribute("data-open-tab")) focused.blur();
}

/**
 * The game on screen when a key or a menu acts, read from the address itself: a key pressed just after a
 * navigation must not act on the page that was there before React has drawn the next one.
 */
export function gameOnScreen(): string | null {
  return /^\/matches\/([^/]+)$/.exec(window.location.pathname)?.[1] ?? null;
}

export type GameSwitchVia = "sidebar" | "key" | "menu" | "picker" | "title_menu" | "window_menu";
export type GameCloseVia = "button" | "middle_click" | "menu" | "key" | "tab_menu";

// The game picker (the + after "Open games", New Tab ⌘T, the title's menu with the sidebar hidden) is one,
// opened from several places: whichever place is on screen draws it.
let pickerOpen = false;
const pickerListeners = new Set<() => void>();
export function setGamePickerOpen(open: boolean) {
  if (pickerOpen === open) return;
  pickerOpen = open;
  for (const listener of pickerListeners) listener();
}
export function useGamePickerOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      pickerListeners.add(listener);
      return () => pickerListeners.delete(listener);
    },
    () => pickerOpen,
    () => pickerOpen,
  );
}

// The game a switch is on its way to. The router keeps the page it leaves on screen until the next one has
// drawn (a transition), so the sidebar would go on selecting the old game, or with its row gone already (it
// was closed) the Library, until then. The sidebar selects this game from the press instead; it is cleared
// once any navigation lands (components/game/game-tab-keys.tsx).
let headingTo: string | null = null;
const headingListeners = new Set<() => void>();
export function setHeadingToGame(id: string | null) {
  if (headingTo === id) return;
  headingTo = id;
  for (const listener of headingListeners) listener();
}
export function useHeadingToGame(): string | null {
  return useSyncExternalStore(
    (listener) => {
      headingListeners.add(listener);
      return () => headingListeners.delete(listener);
    },
    () => headingTo,
    () => headingTo,
  );
}

/**
 * What can be done with the open games, from wherever they are drawn: the sidebar's rows, the title's menu
 * with the sidebar hidden, the keys and the menu bar. On the game page a switch replaces the history entry
 * (Back leaves the games, it doesn't step through them); from any other page it is a step like any link,
 * and Back returns to that page.
 */
export function useGameTabActions() {
  const matchId = useMatch("/matches/:id")?.params.id ?? null;
  const navigate = useNavigate();
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const tabs = useGameTabs(scope);
  const onGame = matchId !== null;
  const tabCount = tabs.tabs.length;

  const goTo = useCallback(
    (id: string, via: GameSwitchVia) => {
      const current = gameOnScreen();
      if (id === current) return;
      leaveField();
      setHeadingToGame(id);
      navigate(`/matches/${id}`, { replace: current !== null, state: { via: "tab" } });
      trackEvent("game_tab_switched", { via, tabs: tabCount, from_game: current !== null });
    },
    [navigate, tabCount],
  );

  /** Whether a game's tab can be closed now: not the game on screen when it is the only one (nothing to go to). */
  const canClose = useCallback((id: string) => !(id === matchId && tabCount < 2), [matchId, tabCount]);

  const close = useCallback(
    (id: string, via: GameCloseVia) => {
      if (!canClose(id) || !tabs.tabs.some((t) => t.id === id)) return;
      const closingShown = id === gameOnScreen();
      // The game after it is selected with the press, before its page has drawn.
      if (closingShown) {
        const at = tabs.tabs.findIndex((t) => t.id === id);
        setHeadingToGame(tabs.tabs[at + 1]?.id ?? tabs.tabs[at - 1]?.id ?? null);
      }
      const next = forgetGameTab(scope, id);
      trackEvent("game_tab_closed", { via, tabs: tabCount - 1, from_game: onGame });
      if (closingShown && next) {
        leaveField();
        navigate(`/matches/${next}`, { replace: true, state: { via: "tab" } });
      }
    },
    [canClose, tabs.tabs, scope, tabCount, onGame, navigate],
  );

  /** Every other tab closes; on the game page the one kept is the game shown. */
  const closeOthers = useCallback(
    (keepId: string) => {
      closeOtherGameTabs(scope, keepId);
      trackEvent("game_tab_closed", { via: "close_others", tabs: 1, from_game: onGame });
      if (onGame && keepId !== matchId) {
        leaveField();
        setHeadingToGame(keepId);
        navigate(`/matches/${keepId}`, { replace: true, state: { via: "tab" } });
      }
    },
    [scope, onGame, matchId, navigate],
  );

  /** The picker's choice: a game with a tab goes to it; another opens in a new one. */
  const pick = useCallback(
    (game: PickableGame) => {
      if (game.open) {
        goTo(game.id, "picker");
        return;
      }
      leaveField();
      setHeadingToGame(game.id);
      navigate(`/matches/${game.id}`, { replace: onGame, state: { via: "picker" } });
    },
    [goTo, navigate, onGame],
  );

  /** Reopen Closed Tab: the tab closed last comes back in its place, as it was left. */
  const reopen = useCallback(() => {
    const back = reopenClosedGameTab(scope);
    if (!back) return;
    trackEvent("game_tab_reopened", { tabs: tabCount + 1 });
    leaveField();
    setHeadingToGame(back.id);
    navigate(`/matches/${back.id}`, { replace: onGame, state: { via: "tab" } });
  }, [scope, tabCount, navigate, onGame]);

  return { matchId, scope, tabs, goTo, close, canClose, closeOthers, pick, reopen };
}
