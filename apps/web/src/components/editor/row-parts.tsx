"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { GripVertical, MoreHorizontal } from "lucide-react";
import type { GroupRunInfo } from "@scoutable/shared/lib/clip-groups";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * What a row needs to be lifted by the pointer engine (use-list-drag.ts):
 * its key, written to the DOM so the engine can find and measure it, and
 * the press that may become a drag. Shifts and the lifted card are the
 * engine's, applied straight to the elements.
 */
export interface RowDragProps {
  rowKey: string;
  onPointerDown: (e: React.PointerEvent) => void;
}

/**
 * The one highlight that follows the playing item: a single element that
 * springs from row to row rather than a class that appears and vanishes.
 */
export function ActiveRowPill() {
  return (
    <motion.div
      layoutId="editor-active-row"
      transition={springs.standard}
      aria-hidden
      className="pointer-events-none absolute inset-y-0.5 inset-x-1 rounded-md bg-primary/12"
    />
  );
}

/**
 * Where the keys act while the list is driven from the keyboard: an inset
 * ring with the active pill's shape. Pointer users never see it.
 */
export function FocusRing({ onSelection }: { onSelection: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0.5 inset-x-1 z-20 rounded-md ring-2",
        onSelection ? "ring-selection-foreground/70" : "ring-selection",
      )}
    />
  );
}

/** Hover-only row controls also show for the focused row, for keyboard focus, and always on touch screens. */
export const REVEAL =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[focused]:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";

function GroupRail({ pos }: { pos: GroupRunInfo["pos"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-1 w-[2px] rounded-full bg-primary/50",
        pos === "first" || pos === "only" ? "top-1.5" : "top-0",
        pos === "last" || pos === "only" ? "bottom-1.5" : "bottom-0",
      )}
    />
  );
}

/** The row's leading column: the group rail and the selection checkbox (shown on hover, or while anything is selected). */
export function RowLead({
  groupPos,
  isSelected,
  showCheckbox,
  onSelect,
}: {
  groupPos?: GroupRunInfo["pos"];
  isSelected: boolean;
  showCheckbox: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="relative z-10 flex w-7 shrink-0 items-center justify-center pointer-coarse:w-9" onClick={(e) => e.stopPropagation()}>
      {groupPos && <GroupRail pos={groupPos} />}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        onClick={onSelect}
        // No focus on press: a focused checkbox counts as a text field for
        // the editor's keys, and they would stop after a tick.
        onMouseDown={(e) => e.preventDefault()}
        aria-label="Select"
        className={cn(
          "size-3.5 rounded accent-primary transition-opacity duration-100 pointer-coarse:size-4",
          showCheckbox || isSelected ? "opacity-100" : REVEAL,
        )}
      />
    </div>
  );
}

// The engine moves rows with transforms, so a row's own transition must
// leave `transform` alone (colors only).
const rowBase =
  "group relative flex min-h-11 cursor-default select-none items-stretch gap-1.5 pr-1.5 outline-none transition-colors duration-100 pointer-coarse:min-h-14";

export function rowClasses({ isSelected, dimmed = false }: { isSelected: boolean; dimmed?: boolean }) {
  return cn(
    rowBase,
    isSelected ? "bg-selection text-selection-foreground" : "hover:bg-fill-1 active:bg-fill-2",
    dimmed && !isSelected && "text-muted-foreground",
  );
}

/**
 * The row's ⋯ menu. Controlled, so a right-click on the row and Shift+F10
 * open the same menu, anchored to this button either way.
 */
export function RowMenu({
  open,
  onOpenChange,
  isSelected,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSelected: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More"
          className={cn(
            "flex size-6 items-center justify-center rounded-md outline-none transition-[opacity,background-color,transform] duration-100 active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-8",
            isSelected ? "hover:bg-white/15" : "hover:bg-fill-2",
            REVEAL,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5 pointer-coarse:size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The handle a finger lifts the row by: holding it for a moment starts the
 * drag (use-list-drag.ts), and `touch-action: none` keeps the browser from
 * scrolling from it. Elsewhere on the row a finger scrolls. A mouse drags
 * the row from anywhere, so the grip stays off coarse-pointer-free screens.
 */
export function DragGrip({ isSelected }: { isSelected: boolean }) {
  return (
    <span
      data-drag-grip
      aria-hidden
      className={cn(
        "hidden size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md pointer-coarse:flex",
        isSelected ? "text-selection-foreground/70" : "text-muted-foreground/70",
      )}
    >
      <GripVertical className="size-4" />
    </span>
  );
}
