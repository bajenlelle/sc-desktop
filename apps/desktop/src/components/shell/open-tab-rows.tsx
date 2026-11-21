import { useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder } from "framer-motion";
import { X } from "lucide-react";
import { gameTabForKey } from "@scoutable/shared/lib/game-tabs";
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
 * it without opening anything: the row follows the pointer, the others slide out of its way on the app's
 * springs, and the new order is kept when it is let go (only then, so nothing else redraws while it moves).
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
}) {
  const reduced = useReducedMotionSafe();

  // While a row is dragged the order is this list's own; it is kept when the row is let go.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  dragOrderRef.current = dragOrder;
  const storeIds = rows.map((t) => t.id);
  const byId = new Map(rows.map((t) => [t.id, t]));
  const ids = dragOrder ? [...dragOrder.filter((id) => byId.has(id)), ...storeIds.filter((id) => !dragOrder.includes(id))] : storeIds;
  const list = ids.map((id) => byId.get(id)!);

  const [dragging, setDragging] = useState<string | null>(null);
  // A press that became a drag is not a click on the row.
  const dragged = useRef(false);

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
      <Reorder.Group as="div" axis="y" values={ids} onReorder={setDragOrder} className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {list.map((tab, index) => {
            const active = tab.id === shownId;
            const closable = canClose(tab.id);
            const choose = () => {
              if (!active) onChoose(tab.id);
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
                  if (order && order.join("\n") !== storeIds.join("\n")) onReorder(order);
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
                            data-open-tab
                            {...rowData}
                            aria-current={active ? "page" : undefined}
                            aria-label={tab.title || "Loading…"}
                            tabIndex={tab.id === stop ? 0 : -1}
                            onFocus={() => setStopId(tab.id)}
                            onPointerDown={(e) => {
                              if (e.button === 0) dragged.current = false;
                            }}
                            // A click opens the row and leaves the keyboard where it was: the page's keys go on working.
                            onMouseDown={(e) => {
                              if (e.button === 0) e.preventDefault();
                            }}
                            onClick={() => {
                              if (!dragged.current) choose();
                            }}
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
                              dragging === tab.id && !active && "bg-fill-2",
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
                          aria-label={`Close ${tab.title || "tab"}`}
                          // For the pointer: the keyboard closes a row with Delete.
                          tabIndex={-1}
                          // In the capture phase: the row's drag listens on the row itself, below React's own handlers,
                          // and a press on the × must be neither a choice of the row nor the start of a drag.
                          onPointerDownCapture={(e) => e.stopPropagation()}
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
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>
    </nav>
  );
}
