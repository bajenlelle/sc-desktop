"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { GripVertical, Link2, MoreHorizontal, X } from "lucide-react";
import type { GroupRunInfo } from "@scoutable/shared/lib/clip-groups";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
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

/**
 * On a group's first row: how many items move together, and the way to
 * take the group apart (the desktop's GroupPill).
 */
export function GroupPill({ size, isSelected, onUngroup }: { size?: number; isSelected: boolean; onUngroup?: () => void }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full py-0.5 pl-1.5 text-caption nums",
        onUngroup ? "pr-0.5" : "pr-1.5",
        isSelected ? "bg-white/20 text-selection-foreground" : "bg-primary/15 text-primary",
      )}
      title={`${size} items move together`}
    >
      <Link2 className="size-2.5" aria-hidden />
      {size}
      {onUngroup && (
        <button
          type="button"
          aria-label="Ungroup"
          title="Ungroup"
          className={cn(
            "ml-0.5 flex size-4 items-center justify-center rounded-full outline-none transition-[background-color,transform] duration-100 active:scale-90 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-6",
            isSelected ? "hover:bg-white/25" : "hover:bg-primary/20",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onUngroup();
          }}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
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

/** A popover one of the menu's items opens in its place (Labels…, Add to playlist…), anchored to the same button. */
export interface RowPopover {
  open: boolean;
  /**
   * Picked from the menu and waiting for it to go: the menu, still on its
   * way out under the pointer, would take the focus back and so dismiss a
   * popover that opened at once. RowMenu opens it (onOpenChange(true)) the
   * moment the menu has closed.
   */
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Its panel: a PopoverContent. */
  content: React.ReactNode;
}

const noop = () => {};

/**
 * The row's ⋯ menu. Controlled, so a right-click on the row and Shift+F10
 * open the same menu, anchored to this button either way. An item may open
 * a popover from the same button: the menu goes, and as it finishes going
 * the popover grows out of where it was, taking the focus the menu would
 * have handed back.
 */
export function RowMenu({
  open,
  onOpenChange,
  isSelected,
  children,
  popover,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSelected: boolean;
  children: React.ReactNode;
  popover?: RowPopover;
}) {
  const popoverOpen = popover?.open ?? false;
  const pending = popover?.pending ?? false;
  const onPopoverOpenChange = React.useRef(popover?.onOpenChange);
  React.useLayoutEffect(() => {
    onPopoverOpenChange.current = popover?.onOpenChange;
  });
  // A popover picked from the menu opens on the first frame the menu is gone
  // from the page: before that, the closing menu takes the focus back.
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!pending || open) return;
    let frame = 0;
    const wait = () => {
      if (menuRef.current?.isConnected) frame = requestAnimationFrame(wait);
      else onPopoverOpenChange.current?.(true);
    };
    frame = requestAnimationFrame(wait);
    return () => cancelAnimationFrame(frame);
  }, [pending, open]);
  return (
    <Popover open={popoverOpen} onOpenChange={popover?.onOpenChange ?? noop}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More"
              className={cn(
                "flex size-6 items-center justify-center rounded-md outline-none transition-[opacity,background-color,transform] duration-100 active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-8",
                isSelected ? "hover:bg-white/15" : "hover:bg-fill-2",
                REVEAL,
                popoverOpen && "opacity-100",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5 pointer-coarse:size-4" />
            </button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          ref={menuRef}
          align="end"
          className="w-56"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            // The popover takes the focus, not this button.
            if (popoverOpen || pending) e.preventDefault();
          }}
        >
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Mounted while open and on its way out (PopoverContent's own presence). */}
      {popover?.content}
    </Popover>
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
