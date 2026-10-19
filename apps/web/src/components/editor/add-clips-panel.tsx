"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { COMPACT_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { fadeVariants, panelVariants, useReducedMotionSafe } from "@/lib/motion";
import { AddClipsContent, type AddClipsSource } from "./add-clips-content";

/**
 * Where the add-clips picker lives. On wide screens it is a side panel over
 * the right of the editor's column, growing out of the button that opened
 * it (a few pixels in from the right, scaling up from the button's point)
 * and leaving the way it came, quicker; it is not modal, so the list stays
 * in view beside it. On phones it is the sheet. Under reduced motion it
 * cross-fades. Mounted only while open, so each opening starts fresh.
 */
export function AddClipsPanel({
  open,
  anchor,
  onClose,
  source,
}: {
  open: boolean;
  /** The box of the button that opened the panel, where it grows from. */
  anchor: DOMRect | null;
  onClose: () => void;
  source: AddClipsSource;
}) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const reduced = useReducedMotionSafe();
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  if (compact) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent showCloseButton={false} aria-describedby={undefined} className="gap-0">
          <DialogTitle className="sr-only">Add clips</DialogTitle>
          <div className="h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-7rem)]">
            <AddClipsContent source={source} onClose={onClose} containerRef={containerRef} compact />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="add-clips"
          aria-label="Add clips"
          variants={reduced ? fadeVariants : panelVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          ref={(el) => {
            // The panel scales from the button's point. A fixed element's
            // offsets are viewport coordinates, untouched by its transform.
            if (!el || !anchor) return;
            el.style.transformOrigin = `${anchor.left + anchor.width / 2 - el.offsetLeft}px ${anchor.top + anchor.height / 2 - el.offsetTop}px`;
          }}
          className="fixed top-[var(--page-bar-height)] right-0 bottom-[var(--tab-bar-height)] z-40 flex w-full max-w-[640px] flex-col bg-material-sheet text-foreground shadow-dialog ring-1 ring-separator"
        >
          <AddClipsContent source={source} onClose={onClose} containerRef={containerRef} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
