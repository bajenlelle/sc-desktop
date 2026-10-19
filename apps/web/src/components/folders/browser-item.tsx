"use client";

import * as React from "react";
import { motion, type TargetAndTransition } from "framer-motion";
import { springs } from "@/lib/motion";
import { dropTargetProps } from "./use-folder-drag";

const SHOWN: TargetAndTransition = { opacity: 1, height: "auto" };
const COLLAPSED: TargetAndTransition = { opacity: 0, height: 0 };
const FADED: TargetAndTransition = { opacity: 0 };

/**
 * One row of the Playlists page (a folder or a playlist) inside a grouped
 * list: it opens out when it arrives (a new folder, a move undone) and
 * folds shut when it leaves (moved away, deleted), so the rows around it
 * slide rather than jump; under reduced motion it only fades. Rows present
 * when the list first shows don't animate (AnimatePresence initial={false}).
 *
 * The shell is also what the drag engine lifts and what it drops onto: a
 * folder row is a drop target (`dropFolder`), a lifted row dims, a lit
 * target shows an inset pill. A right-click, Shift+F10 or the context-menu
 * key opens the row's ⋯ menu (`onOpenMenu`), anchored to its button.
 */
export function BrowserItem({
  dropFolder,
  onPointerDown,
  onOpenMenu,
  reducedMotion,
  animated = true,
  children,
}: {
  /** The folder a drop here goes into; undefined: not a drop target. */
  dropFolder?: string | null;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onOpenMenu?: () => void;
  reducedMotion: boolean;
  /** False for lists that change with every keystroke (search results): rows just appear. */
  animated?: boolean;
  children: React.ReactNode;
}) {
  const hidden = reducedMotion ? FADED : COLLAPSED;
  return (
    <motion.div
      initial={animated ? hidden : false}
      animate={SHOWN}
      exit={animated ? hidden : undefined}
      transition={springs.standard}
      {...(dropFolder !== undefined ? dropTargetProps(dropFolder) : {})}
      className="group/item relative overflow-hidden select-none [-webkit-touch-callout:none]"
      onPointerDown={onPointerDown}
      onContextMenu={
        onOpenMenu
          ? (e) => {
              e.preventDefault();
              onOpenMenu();
            }
          : undefined
      }
      onKeyDown={
        onOpenMenu
          ? (e) => {
              if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
                e.preventDefault();
                onOpenMenu();
              }
            }
          : undefined
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-1 rounded-md bg-primary/10 opacity-0 ring-2 ring-selection transition-opacity duration-150 group-data-[drop-active]/item:opacity-100"
      />
      <div className="relative transition-opacity duration-150 group-data-[drag-source]/item:opacity-40">{children}</div>
    </motion.div>
  );
}
