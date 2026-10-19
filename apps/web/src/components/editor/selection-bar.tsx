"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileDown, Trash2, X } from "lucide-react";
import type { ExportPurpose } from "@scoutable/shared/lib/game-video-wire";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fadeVariants, riseVariants, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ExportMenuItems } from "./editor-actions";
import type { UseExport } from "./use-export";

/** Labels show when the list column is wide enough (a container query on the list); icons carry the meaning below that. */
const PILL_LABEL = "hidden @min-[24rem]:inline";

/** A compact action in the selection pill. */
function PillButton({
  className,
  tone = "default",
  icon = false,
  ...props
}: React.ComponentProps<"button"> & { tone?: "default" | "destructive"; icon?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap outline-none transition-[background-color,color,transform,opacity] duration-100 active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:h-9 pointer-coarse:px-3 [&_svg]:size-3.5 [&_svg]:shrink-0",
        icon && "w-7 justify-center px-0 pointer-coarse:w-9",
        tone === "destructive"
          ? "text-destructive hover:bg-destructive/10 active:bg-destructive/20"
          : "text-foreground hover:bg-fill-2 active:bg-fill-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * What you can do with the rows you picked, floating over the bottom of the
 * list the moment something is selected and leaving the same way. It never
 * pushes the rows around. The parent must be a `@container` and positioned.
 * Under reduced motion it cross-fades; the material goes solid under
 * reduced transparency (globals.css). Export offers the toolbar's two
 * verbs for just the rows picked.
 */
export function SelectionBar({
  count,
  onRemove,
  onClear,
  exporter,
  onExport,
}: {
  count: number;
  onRemove: () => void;
  onClear: () => void;
  /** With both, an Export menu: a download or a link of the selection. */
  exporter?: UseExport;
  onExport?: (purpose: ExportPurpose) => void;
}) {
  const reduced = useReducedMotionSafe();
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key="selection-bar"
          variants={reduced ? fadeVariants : riseVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="pointer-events-none sticky bottom-[calc(var(--tab-bar-height)+0.75rem)] z-30 -mt-12 flex h-12 items-end justify-center px-3"
        >
          <div
            role="toolbar"
            aria-label="Selection"
            className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-full bg-material-popover py-1 pr-1 pl-3 shadow-menu ring-1 ring-separator backdrop-blur-xl"
          >
            <span className="mr-1 shrink-0 text-sm font-medium nums">
              {count}
              <span className={cn(PILL_LABEL, "ml-1")}>selected</span>
            </span>
            {exporter && onExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PillButton title="Export the selection" aria-label="Export the selection">
                    <FileDown />
                    <span className={PILL_LABEL}>Export</span>
                  </PillButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-56">
                  <ExportMenuItems exporter={exporter} onExport={onExport} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <PillButton tone="destructive" onClick={onRemove} title="Remove from playlist">
              <Trash2 />
              <span className={PILL_LABEL}>Remove</span>
            </PillButton>
            <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-separator" />
            <PillButton icon aria-label="Deselect" title="Deselect" onClick={onClear}>
              <X />
            </PillButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
