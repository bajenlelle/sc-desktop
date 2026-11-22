import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { gameTabForKey } from "@scoutable/shared/lib/game-tabs";
import { moveBlock } from "@scoutable/shared/lib/clip-groups";
import { useListDrag } from "@/components/editor/use-list-drag";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type TabCloseVia = "button" | "middle_click" | "key" | "tab_menu";

export interface OpenTabRow {
  id: string;
  /** The row's accessible name; empty while it loads. */
  title: string;
  /** What the row shows. */
  name: React.ReactNode;
  /** The tooltip's lines. */
  tooltip: React.ReactNode;
}

/**
 * The sidebar's lists of open things (Open games, Open teams): a caption with an optional action after it,
 * and rows that open, close and drag into another order. One list, so both behave alike.
 *
 * A row lights on the press and opens on the release (a click), so a press can turn into a drag that moves
 * it without opening anything. The drag is the editor's list drag (editor/use-list-drag.ts): the row lifts
 * into a card glued to the pointer, the others slide out of its way on the app's springs, the sidebar
 * scrolls while the pointer is at or past its edge, and the slot follows the card through any scroll, so
 * the row lands where the card is. The new order is kept when it is let go (only then, so nothing else
 * redraws while it moves); Escape puts it back.
 * Its × (on hover or focus), a middle click and its menu close it; a row `canClose` refuses keeps its ×
 * hidden. The keyboard moves along the rows with ↓ and ↑, Return or Space opens one, Delete closes it. A
 * click doesn't take the keyboard's focus: the page's keys go on working.
 */
export function OpenTabRows({
  label,
  action,
  rows,
  shownId,
  canClose,
  onChoose,
  onClose,
  onCloseOthers,
  onReorder,
  rowData,
  noun,
}: {
  label: string;
  /** After the caption: Open games' +. */
  action?: React.ReactNode;
  rows: readonly OpenTabRow[];
  /** The row of the page on screen. */
  shownId: string | null;
  canClose: (id: string) => boolean;
  onChoose: (id: string) => void;
  onClose: (id: string, via: TabCloseVia) => void;
  onCloseOthers: (keepId: string) => void;
  onReorder: (order: string[]) => void;
  /** Extra data attributes on each row's button (Open games' `data-open-game`, which keeps its focus on a switch). */
  rowData?: Record<`data-${string}`, string>;
  /** What a row is, for its × while its title loads: "Close game". */
  noun: string;
}) {
  const reduced = useReducedMotionSafe();
  const ids = rows.map((t) => t.id);
  const list = rows;

  // The rows' own column, measured in its coordinates so a scroll never moves the slot off the card, and
  // the sidebar's scroller, which the drag scrolls at its edges.
  const groupRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scrollerRef.current = groupRef.current?.closest<HTMLElement>("[data-sidebar-scroll]") ?? null;
  });
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const drag = useListDrag({
    listRef: groupRef,
    sidebarRef: scrollerRef,
    reducedMotion: reduced,
    noDragSelector: "[data-no-drag]",
    keepFocus: true,
    holdOutside: true,
    quietCard: true,
    canStart: () => true,
    blockFor: (key) => [key],
    snapGap: (gap) => gap,
    onTarget: () => {},
    onDrop: ({ gap, anchorKey }) => {
      const current = idsRef.current;
      const from = current.indexOf(anchorKey);
      if (from < 0) return;
      const order = moveBlock(current, [from], gap);
      // Dragged past a neighbour and back is not a new order.
      if (order.join("\n") !== current.join("\n")) onReorder(order);
    },
    onDropOnPlaylist: () => {},
    onEnd: () => {},
  });

  // The one Tab stop: the row the focus was on last, else the shown one's, else the first.
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
    <nav aria-label={label} className="mt-5 flex flex-col px-2">
      <div className="flex h-6 items-center justify-between pr-0.5 pl-2">
        <span className="text-caption font-medium text-muted-foreground">{label}</span>
        {action}
      </div>
      {/* No gap between rows: each row carries its 2px below it, so the drag's slots are the rows' own heights. */}
      <div ref={groupRef} className="flex flex-col">
        <AnimatePresence initial={false}>
          {list.map((tab, index) => {
            const active = tab.id === shownId;
            const closable = canClose(tab.id);
            const choose = () => {
              if (!active) onChoose(tab.id);
            };
            return (
              <motion.div
                key={tab.id}
                data-row-key={tab.id}
                transition={rowTransition}
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 30 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                onPointerDown={(e) => drag.onRowPointerDown(e, tab.id)}
                className="group relative shrink-0 pb-0.5"
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div data-drag-face className="h-7">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            ref={(el) => {
                              if (el) buttons.current.set(tab.id, el);
                              else buttons.current.delete(tab.id);
                            }}
                            type="button"
                            data-open-tab
                            {...rowData}
                            aria-current={active ? "page" : undefined}
                            aria-label={tab.title || "Loading…"}
                            tabIndex={tab.id === stop ? 0 : -1}
                            onFocus={() => setStopId(tab.id)}
                            // A click opens the row and leaves the keyboard where it was: the page's keys go on working.
                            // (The drag's press handler prevents the default, so a click doesn't focus the row, and
                            // swallows the click a drag ends with.)
                            onClick={choose}
                            onAuxClick={(e) => {
                              if (e.button !== 1) return;
                              e.preventDefault();
                              if (closable) onClose(tab.id, "middle_click");
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
                                onClose(tab.id, "key");
                              }
                            }}
                            className={cn(
                              "flex h-7 w-full min-w-0 items-center rounded-md pl-2 text-left text-sm font-medium outline-none transition-[background-color,transform] duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection",
                              closable ? "pr-7" : "pr-2",
                              active ? "bg-row-selected text-foreground" : "text-foreground hover:bg-fill-1 active:bg-fill-2",
                            )}
                          >
                            {tab.name}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="flex flex-col gap-0.5">
                          {tab.tooltip}
                        </TooltipContent>
                      </Tooltip>
                      {closable && (
                        <button
                          type="button"
                          aria-label={`Close ${tab.title || noun}`}
                          // For the pointer: the keyboard closes a row with Delete.
                          tabIndex={-1}
                          // A press on the × is neither a choice of the row nor the start of a drag.
                          data-no-drag
                          onClick={() => onClose(tab.id, "button")}
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
                    <ContextMenuItem disabled={!closable} onSelect={() => onClose(tab.id, "tab_menu")}>
                      Close Tab
                    </ContextMenuItem>
                    <ContextMenuItem disabled={list.length < 2} onSelect={() => onCloseOthers(tab.id)}>
                      Close Other Tabs
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </nav>
  );
}
