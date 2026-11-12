import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { GameTab } from "@scoutable/shared/lib/game-tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format-date";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The open games, as a tab bar under the game page's toolbar (Finder's and
 * Safari's). The tabs share the row equally; the shown game is the segmented
 * control's raised thumb, the others are recessed. A tab activates on press
 * (pointer down), as Safari's do; the keyboard activates it on click. The ×
 * appears on hover or focus, and a middle click closes a tab too.
 *
 * The page remounts on every switch, so the thumb can't slide: it moves at
 * once, and the press is the feedback.
 */
export function GameTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: readonly GameTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string, via: "button" | "middle_click") => void;
}) {
  return (
    <div role="tablist" aria-label="Open games" className="flex min-w-0 flex-1 items-center gap-1">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const select = () => {
            if (!active) onSelect(tab.id);
          };
          return (
            <motion.div
              key={tab.id}
              layout
              transition={springs.standard}
              exit={{ opacity: 0, width: 0, flexGrow: 0 }}
              className="group relative flex min-w-0 flex-1 basis-0"
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
                      "relative h-7 min-w-0 flex-1 basis-0 rounded-md px-6 text-sm outline-none select-none transition-[background-color,color,transform] duration-100 focus-visible:ring-2 focus-visible:ring-selection",
                      active
                        ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_var(--separator)]"
                        : "bg-fill-1 text-muted-foreground hover:bg-fill-2 hover:text-foreground active:scale-[0.98] active:bg-fill-3",
                    )}
                  >
                    <span className="block truncate text-center">
                      {tab.title || <span className="text-muted-foreground">Loading…</span>}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                  <span>{tab.title || "Loading…"}</span>
                  {tab.date && <span className="text-muted-foreground nums">{formatDate(tab.date, "medium")}</span>}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onClose(tab.id, "button")}
                className="absolute top-1/2 left-1.5 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none transition-[opacity,background-color] duration-100 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-fill-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
              >
                <X className="size-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
