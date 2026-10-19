"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Folder, ListVideo } from "lucide-react";
import type { DragCard } from "./use-folder-drag";

/**
 * The lifted card while a playlist or folder is dragged: a floating chip on
 * the popover material that starts as the row (same icon, name and line
 * under it, at the row's width) and gathers under the pointer. Its position,
 * width, scale and opacity are the engine's motion values; this only draws
 * them. Under the reduced-transparency setting the material is solid.
 */
export function DragCardView({ card }: { card: DragCard }) {
  const { item } = card;
  return createPortal(
    <motion.div
      aria-hidden
      style={{
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
        scale: card.scale,
        opacity: card.opacity,
        originX: 0.15,
        originY: 0.5,
      }}
      className="pointer-events-none fixed top-0 left-0 z-[60] flex items-center gap-3 overflow-hidden rounded-lg bg-material-popover px-4 text-left shadow-dialog backdrop-blur-xl will-change-transform"
    >
      <span className="flex shrink-0 items-center text-primary [&_svg]:size-4">
        {item.kind === "folder" ? <Folder className="fill-primary/15" /> : <ListVideo />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
        {item.detail && <span className="truncate text-callout text-muted-foreground">{item.detail}</span>}
      </span>
    </motion.div>,
    document.body,
  );
}
