import { useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder } from "framer-motion";
import { X } from "lucide-react";
import { gameTabForKey, tabTitleParts, type GameTab } from "@scoutable/shared/lib/game-tabs";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format-date";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The open games as tabs, the way Notion and a browser draw them: from the
 * left at their own width (they shrink together when there are many, and are
 * never stretched to fill the row), the shown game's tab in the page's own
 * colour so it leads into the toolbar under it, the others plain until
 * pointed at.
 *
 * A tab is chosen on the press, as Safari's are, and the same press can carry
 * on as a drag: the tab follows the pointer, the others slide out of its way,
 * and a tab let go past an end springs back. The × is on the right, always there on the shown tab
 * and on hover or focus on the others; a middle click closes a tab too, and a
 * right-click has Close Tab and Close Other Tabs.
 *
 * The keyboard works them as a tab list (W3C's Tabs pattern): Tab stops once,
 * on the shown game's tab; ← and → move the focus along the tabs and round
 * the ends, Home and End go to the first and the last; Return or Space
 * chooses the tab the focus is on (not the arrows: a game takes a moment to
 * open) and the focus stays on it; Delete closes it and the focus goes to the
 * tab after it. The × buttons are for the pointer and aren't Tab stops. A click
 * on a tab doesn't take the focus: the game's keys go on working.
 */
export function GameTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseOthers,
  onReorder,
  onReordered,
}: {
  tabs: readonly GameTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string, via: "button" | "middle_click" | "key" | "tab_menu") => void;
  onCloseOthers: (keepId: string) => void;
  /** The tabs' ids in their new order, each time a dragged tab passes another. */
  onReorder: (order: string[]) => void;
  /** A drag has been let go with the tabs in another order than it started from. */
  onReordered: () => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = tabs.map((t) => t.id);
  // The order a drag started from, and the order as it stands (the drag's end reads it after its last swap).
  const orderAtStart = useRef("");
  const latestIds = useRef(ids);
  latestIds.current = ids;

  // The one Tab stop: the tab the keyboard's focus was last on, else the shown game's.
  const [stopId, setStopId] = useState<string | null>(null);
  const stop = stopId !== null && ids.includes(stopId) ? stopId : activeId;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusTab = (id: string) => buttons.current.get(id)?.focus();
  // After Delete the focus goes to the tab that followed, once the closed one is out of the strip.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const id = focusNext.current;
    if (!id || !ids.includes(id)) return;
    focusNext.current = null;
    focusTab(id);
  });

  return (
    <Reorder.Group
      as="div"
      axis="x"
      role="tablist"
      aria-label="Open games"
      values={ids}
      onReorder={onReorder}
      className="flex min-w-0 items-end"
    >
      <AnimatePresence initial={false}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const select = () => {
            if (!active) onSelect(tab.id);
          };
          const parts = tabTitleParts(tab.title);
          return (
            <Reorder.Item
              key={tab.id}
              as="div"
              value={tab.id}
              // No drag constraints: given the strip as its bounds, the library rescales every resting tab's offset
              // whenever the strip changes size, so closing a tab left the others out of place and over each other.
              // A tab let go past an end springs back into the strip.
              transition={springs.standard}
              onDragStart={() => {
                orderAtStart.current = ids.join("\n");
                setDragging(tab.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                // Dragged past a neighbour and back is not a new order.
                if (orderAtStart.current !== latestIds.current.join("\n")) onReordered();
              }}
              exit={{ opacity: 0, width: 0, minWidth: 0 }}
              // A width, not a flex-basis: WebKit sizes the strip by its tabs' untruncated titles otherwise, and
              // the + drifts away from the last tab.
              className={cn("group relative flex h-8 w-52 min-w-[6.5rem] shrink", dragging === tab.id && "z-10")}
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="flex h-8 w-full min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          ref={(el) => {
                            if (el) buttons.current.set(tab.id, el);
                            else buttons.current.delete(tab.id);
                          }}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          // The title is laid out in two parts when it names two teams; its name stays the whole title.
                          aria-label={tab.title || "Loading…"}
                          tabIndex={tab.id === stop ? 0 : -1}
                          onFocus={() => setStopId(tab.id)}
                          // A click chooses the tab and leaves the keyboard where it was: with the focus on a tab,
                          // Space and the arrows would be the tab list's and not the game's.
                          onMouseDown={(e) => {
                            if (e.button === 0) e.preventDefault();
                          }}
                          onPointerDown={(e) => {
                            if (e.button === 0) select();
                          }}
                          onAuxClick={(e) => {
                            if (e.button !== 1) return;
                            e.preventDefault();
                            onClose(tab.id, "middle_click");
                          }}
                          onKeyDown={(e) => {
                            if (e.metaKey || e.ctrlKey || e.altKey) return;
                            const to = gameTabForKey(ids, tab.id, e.key);
                            if (to) {
                              e.preventDefault();
                              focusTab(to);
                            } else if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              select();
                            } else if (e.key === "Delete" || e.key === "Backspace") {
                              e.preventDefault();
                              focusNext.current = ids[index + 1] ?? ids[index - 1] ?? null;
                              onClose(tab.id, "key");
                            }
                          }}
                          className={cn(
                            "h-8 w-full min-w-0 rounded-t-lg border border-b-0 pr-7 pl-3 text-left text-sm outline-none select-none transition-[background-color,color] duration-100 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-inset",
                            active
                              ? "border-separator bg-background font-medium text-foreground"
                              : "border-transparent text-muted-foreground hover:bg-fill-2 hover:text-foreground active:bg-fill-3",
                          )}
                        >
                          {!tab.title ? (
                            <span className="block truncate text-muted-foreground">Loading…</span>
                          ) : parts ? (
                            // Each team is cut short by itself, so two games of the same home team don't read the same.
                            <span className="flex min-w-0">
                              <span className="min-w-0 truncate">{parts.home}</span>
                              <span className="shrink-0 whitespace-pre"> vs </span>
                              <span className="min-w-0 truncate">{parts.away}</span>
                            </span>
                          ) : (
                            <span className="block truncate">{tab.title}</span>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                        <span>{tab.title || "Loading…"}</span>
                        {tab.date && <span className="text-muted-foreground nums">{formatDate(tab.date, "medium")}</span>}
                      </TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      aria-label={`Close ${tab.title || "game"}`}
                      // For the pointer: the keyboard closes a tab with Delete.
                      tabIndex={-1}
                      // In the capture phase: the tab's drag listens on the tab itself, below React's own handlers,
                      // and a press on the × must be neither a choice of the tab nor the start of a drag.
                      onPointerDownCapture={(e) => e.stopPropagation()}
                      onClick={() => onClose(tab.id, "button")}
                      className={cn(
                        "absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-[opacity,background-color,color] duration-100 hover:bg-fill-3 hover:text-foreground active:bg-fill-4",
                        // The shown game can always be closed; the others show theirs when pointed at.
                        active ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                      )}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onClose(tab.id, "tab_menu")}>Close Tab</ContextMenuItem>
                  <ContextMenuItem disabled={tabs.length < 2} onSelect={() => onCloseOthers(tab.id)}>
                    Close Other Tabs
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </Reorder.Item>
          );
        })}
      </AnimatePresence>
    </Reorder.Group>
  );
}
