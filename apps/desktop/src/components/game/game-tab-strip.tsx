import { useRef, useState } from "react";
import { AnimatePresence, Reorder } from "framer-motion";
import { X } from "lucide-react";
import type { GameTab } from "@scoutable/shared/lib/game-tabs";
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
 * A tab is chosen on the press, as Safari's are (the keyboard chooses on
 * click), and the same press can carry on as a drag: the tab follows the
 * pointer, the others slide out of its way, and the ends resist. The × is on
 * the right, always there on the shown tab and on hover or focus on the
 * others; a middle click closes a tab too.
 */
export function GameTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onReordered,
}: {
  tabs: readonly GameTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string, via: "button" | "middle_click") => void;
  /** The tabs' ids in their new order, each time a dragged tab passes another. */
  onReorder: (order: string[]) => void;
  /** A drag that changed the order has been let go. */
  onReordered: () => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const changed = useRef(false);

  return (
    <Reorder.Group
      ref={stripRef}
      as="div"
      axis="x"
      role="tablist"
      aria-label="Open games"
      values={tabs.map((t) => t.id)}
      onReorder={(order: string[]) => {
        changed.current = true;
        onReorder(order);
      }}
      className="flex min-w-0 items-end"
    >
      <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const select = () => {
            if (!active) onSelect(tab.id);
          };
          return (
            <Reorder.Item
              key={tab.id}
              as="div"
              value={tab.id}
              dragConstraints={stripRef}
              dragElastic={0.15}
              transition={springs.standard}
              onDragStart={() => {
                changed.current = false;
                setDragging(tab.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                if (changed.current) onReordered();
              }}
              exit={{ opacity: 0, width: 0, minWidth: 0 }}
              // A width, not a flex-basis: WebKit sizes the strip by its tabs' untruncated titles otherwise, and
              // the + drifts away from the last tab.
              className={cn("group relative flex h-8 w-52 min-w-[6.5rem] shrink", dragging === tab.id && "z-10")}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onPointerDown={(e) => {
                      if (e.button === 0) select();
                    }}
                    // A pointer already acted on press; this is the keyboard's Space or Enter.
                    onClick={(e) => {
                      if (e.detail === 0) select();
                    }}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return;
                      e.preventDefault();
                      onClose(tab.id, "middle_click");
                    }}
                    className={cn(
                      "h-8 w-full min-w-0 rounded-t-lg border border-b-0 pr-7 pl-3 text-left text-sm outline-none select-none transition-[background-color,color] duration-100 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-inset",
                      active
                        ? "border-separator bg-background font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-fill-2 hover:text-foreground active:bg-fill-3",
                    )}
                  >
                    <span className="block truncate">{tab.title || <span className="text-muted-foreground">Loading…</span>}</span>
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
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onClose(tab.id, "button")}
                className={cn(
                  "absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-[opacity,background-color,color] duration-100 hover:bg-fill-3 hover:text-foreground active:bg-fill-4 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection",
                  // The shown game can always be closed; the others show theirs when pointed at.
                  active ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                )}
              >
                <X className="size-3" />
              </button>
            </Reorder.Item>
          );
        })}
      </AnimatePresence>
    </Reorder.Group>
  );
}
