import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder } from "framer-motion";
import { Plus, X } from "lucide-react";
import { gameTabForKey, tabTitleParts } from "@scoutable/shared/lib/game-tabs";
import { GameTabPicker } from "@/components/game/game-tab-picker";
import { setGamePickerOpen, useGamePickerOpen, useGameTabActions, useHeadingToGame } from "@/components/game/use-game-tab-actions";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format-date";
import { reorderGameTabs } from "@/lib/game-tabs";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** The + after the caption, with its tooltip; the picker's trigger hands it its props and ref. */
function OpenAnotherButton(props: React.ComponentProps<"button">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Open another game"
          {...props}
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 active:bg-fill-3 data-[state=open]:bg-fill-2 data-[state=open]:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
        >
          <Plus className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        Open another game <span className="text-muted-foreground">{IS_MACOS ? "⌘T" : "Ctrl T"}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** "Fryshuset Bask… vs AIK": each team cut short by itself, so two games of the same home team don't read the same. */
function GameName({ title }: { title: string }) {
  const parts = tabTitleParts(title);
  if (!title) return <span className="min-w-0 truncate text-muted-foreground">Loading…</span>;
  if (!parts) return <span className="min-w-0 truncate">{title}</span>;
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate">{parts.home}</span>
      <span className="shrink-0 whitespace-pre"> vs </span>
      <span className="min-w-0 truncate">{parts.away}</span>
    </span>
  );
}

/**
 * The open games, as the sidebar's second list (the way VS Code's Open Editors and Arc's tabs sit beside the
 * content): there from any page, so a game left for a playlist is one click away, as it was left. Under a
 * caption with a + that opens another game (the picker, as New Tab ⌘T does). The game on screen is the
 * selected row, and the Library row is not. The titles start at the caption's edge: a row has no icon.
 *
 * A row lights on the press and opens the game on the release (a click), so a press can turn into a drag
 * that moves it without opening anything: the row follows the pointer, the others slide out of its way on
 * the app's springs, and the new order is kept when it is let go (only then, so nothing else redraws while
 * it moves). Selecting follows the click at once, before the game's page has drawn. Its × (on hover or
 * focus), a middle click and its menu close it; the game on screen when it is the only one can't be closed
 * (there is no game to give the page to: the toolbar's back button leaves the game). The keyboard moves
 * along the rows with ↓ and ↑, Return or Space opens one, Delete closes it. A click doesn't take the
 * keyboard's focus: the game's keys go on working.
 */
export function OpenGames() {
  const { activeOrgId } = useAuth();
  const { matchId, scope, tabs, goTo, close, canClose, closeOthers, pick } = useGameTabActions();
  // The game a switch is on its way to is the one selected, from the click (use-game-tab-actions.ts).
  const headingTo = useHeadingToGame();
  const shownId = headingTo ?? matchId;
  // With the sidebar hidden the picker opens at the game's title instead (components/game/game-toolbar-parts.tsx).
  const pickerOpen = useGamePickerOpen();
  const collapsed = useSidebarCollapsed();
  const picking = pickerOpen && !collapsed;
  const reduced = useReducedMotionSafe();

  // While a row is dragged the order is this list's own; it is kept when the row is let go.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  dragOrderRef.current = dragOrder;
  const storeIds = tabs.tabs.map((t) => t.id);
  const byId = new Map(tabs.tabs.map((t) => [t.id, t]));
  const ids = dragOrder ? [...dragOrder.filter((id) => byId.has(id)), ...storeIds.filter((id) => !dragOrder.includes(id))] : storeIds;
  const list = ids.map((id) => byId.get(id)!);
  const openIds = useMemo(() => new Set(storeIds), [storeIds.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [dragging, setDragging] = useState<string | null>(null);
  // A press that became a drag is not a click on the row.
  const dragged = useRef(false);

  // The one Tab stop: the row the focus was on last, else the game on screen's, else the first.
  const [stopId, setStopId] = useState<string | null>(null);
  const stop = stopId !== null && ids.includes(stopId) ? stopId : shownId !== null && ids.includes(shownId) ? shownId : (ids[0] ?? null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusRow = (id: string) => buttons.current.get(id)?.focus();
  // After Delete the focus goes to the row that followed, once the closed one is out of the list.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const id = focusNext.current;
    if (!id || !ids.includes(id)) return;
    focusNext.current = null;
    focusRow(id);
  });

  if (list.length === 0) return null;
  const rowTransition = reduced ? { duration: 0 } : springs.standard;

  return (
    <nav aria-label="Open games" className="mt-5 flex flex-col px-2">
      <div className="flex h-6 items-center justify-between pr-0.5 pl-2">
        <span className="text-caption font-medium text-muted-foreground">Open games</span>
        <GameTabPicker
          open={picking}
          onOpenChange={setGamePickerOpen}
          orgId={activeOrgId}
          openIds={openIds}
          onPick={pick}
          side="right"
        >
          <OpenAnotherButton />
        </GameTabPicker>
      </div>
      <Reorder.Group as="div" axis="y" values={ids} onReorder={setDragOrder} className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {list.map((tab, index) => {
            const active = tab.id === shownId;
            const closable = canClose(tab.id);
            const choose = () => {
              if (!active) goTo(tab.id, "sidebar");
            };
            return (
              <Reorder.Item
                key={tab.id}
                as="div"
                value={tab.id}
                transition={rowTransition}
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 28 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                onDragStart={() => {
                  dragged.current = true;
                  setDragOrder((order) => order ?? storeIds);
                  setDragging(tab.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  const order = dragOrderRef.current;
                  setDragOrder(null);
                  // Dragged past a neighbour and back is not a new order.
                  if (order && order.join("\n") !== storeIds.join("\n")) {
                    reorderGameTabs(scope, order);
                    trackEvent("game_tabs_reordered", { tabs: order.length });
                  }
                }}
                className={cn("group relative shrink-0", dragging === tab.id && "z-10")}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="h-7">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            ref={(el) => {
                              if (el) buttons.current.set(tab.id, el);
                              else buttons.current.delete(tab.id);
                            }}
                            type="button"
                            data-open-game
                            aria-current={active ? "page" : undefined}
                            aria-label={tab.title || "Loading…"}
                            tabIndex={tab.id === stop ? 0 : -1}
                            onFocus={() => setStopId(tab.id)}
                            onPointerDown={(e) => {
                              if (e.button === 0) dragged.current = false;
                            }}
                            // A click opens the game and leaves the keyboard where it was: the game's keys go on working.
                            onMouseDown={(e) => {
                              if (e.button === 0) e.preventDefault();
                            }}
                            onClick={() => {
                              if (!dragged.current) choose();
                            }}
                            onAuxClick={(e) => {
                              if (e.button !== 1) return;
                              e.preventDefault();
                              close(tab.id, "middle_click");
                            }}
                            onKeyDown={(e) => {
                              if (e.metaKey || e.ctrlKey || e.altKey) return;
                              const to = gameTabForKey(ids, tab.id, e.key);
                              if (to) {
                                e.preventDefault();
                                focusRow(to);
                              } else if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                choose();
                              } else if (e.key === "Delete" || e.key === "Backspace") {
                                e.preventDefault();
                                if (!closable) return;
                                focusNext.current = ids[index + 1] ?? ids[index - 1] ?? null;
                                close(tab.id, "key");
                              }
                            }}
                            className={cn(
                              "flex h-7 w-full min-w-0 items-center rounded-md pl-2 text-left text-sm font-medium outline-none transition-[background-color,transform] duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection",
                              closable ? "pr-7" : "pr-2",
                              active ? "bg-row-selected text-foreground" : "text-foreground hover:bg-fill-1 active:bg-fill-2",
                              dragging === tab.id && !active && "bg-fill-2",
                            )}
                          >
                            <GameName title={tab.title} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="flex flex-col gap-0.5">
                          <span>{tab.title || "Loading…"}</span>
                          {tab.date && <span className="text-muted-foreground nums">{formatDate(tab.date, "medium")}</span>}
                        </TooltipContent>
                      </Tooltip>
                      {closable && (
                        <button
                          type="button"
                          aria-label={`Close ${tab.title || "game"}`}
                          // For the pointer: the keyboard closes a row with Delete.
                          tabIndex={-1}
                          // In the capture phase: the row's drag listens on the row itself, below React's own handlers,
                          // and a press on the × must be neither a choice of the row nor the start of a drag.
                          onPointerDownCapture={(e) => e.stopPropagation()}
                          onClick={() => close(tab.id, "button")}
                          className={cn(
                            "absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-md outline-none transition-[opacity,background-color,color] duration-100 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                            "text-muted-foreground hover:bg-fill-3 hover:text-foreground active:bg-fill-4",
                          )}
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem disabled={!closable} onSelect={() => close(tab.id, "tab_menu")}>
                      Close Tab
                    </ContextMenuItem>
                    <ContextMenuItem disabled={list.length < 2} onSelect={() => closeOthers(tab.id)}>
                      Close Other Tabs
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>
    </nav>
  );
}
