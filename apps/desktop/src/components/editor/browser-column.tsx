import * as React from "react";
import { motion } from "framer-motion";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MACOS } from "@/lib/platform";
import { useColumnResize } from "@/lib/use-column-resize";
import { cn } from "@/lib/utils";

export const BROWSER_WIDTH = { default: 260, min: 200, max: 480 } as const;

/**
 * The playlist browser's column, the Playlists page's second sidebar: resized
 * by its edge as the window's sidebar is (lib/use-column-resize.ts: 1:1,
 * rubber-banding, a flick inward collapses it, one spring to open or close).
 * Closed, the editor's left edge pulls it back out 1:1, or opens it with a
 * click; the toolbar's playlists button and ⌘B do both ways.
 *
 * Its edge is an inner divider, so it looks like every other one
 * (components/ui/resizable.tsx): a hairline that thickens to a gray line on
 * hover and darkens while dragged. Only the window's sidebar edge is blue.
 */
export function BrowserColumn({
  collapsed,
  width,
  onWidthChange,
  onCollapse,
  onExpand,
  className,
  children,
}: {
  collapsed: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
  /** Open again at `width`: from the closed browser's grip. */
  onExpand: (width: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  /** The closed edge's "Show playlists" label. */
  const [tipOpen, setTipOpen] = React.useState(false);
  /**
   * A drag keeps the label away until the pointer comes back onto the edge
   * afresh: the pointer moves of a drag would otherwise arm the tooltip,
   * which then showed the moment the browser closed.
   */
  const tipSuppressed = React.useRef(false);
  const { w, innerW, dragMode, edgeProps } = useColumnResize({
    collapsed,
    width,
    limits: BROWSER_WIDTH,
    onWidthChange,
    onCollapse,
    onExpand,
    onDragStart: () => {
      tipSuppressed.current = true;
      setTipOpen(false);
    },
  });

  return (
    <motion.div style={{ width: w }} className="relative h-full shrink-0 select-none">
      <div
        aria-hidden={collapsed || undefined}
        className={cn("relative h-full w-full overflow-hidden", className)}
      >
        <motion.div style={{ width: innerW }} className="flex h-full flex-col">
          {children}
        </motion.div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-separator" />
      </div>
      {/* The edge, open or closed, is one element, so its highlight never
          doubles up while the browser opens or closes under the pointer.
          Open, it resizes from any height, straddling the divider. Closed,
          it moves wholly onto the editor (the browser's edge may be the
          window's) and pulls the browser back out 1:1. Hovered, the divider
          thickens to a gray line; dragged, it darkens. */}
      <Tooltip
        open={tipOpen && collapsed && !dragMode}
        onOpenChange={(open) => setTipOpen(open && !tipSuppressed.current)}
      >
        <TooltipTrigger asChild>
          <div
            {...edgeProps}
            aria-label={collapsed ? "Show the playlist browser" : "Resize the playlist browser"}
            onPointerEnter={() => {
              if (!dragMode) tipSuppressed.current = false;
            }}
            className={cn(
              "group/edge absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize outline-none transition-transform duration-200 motion-reduce:transition-none",
              collapsed && "translate-x-1.5",
            )}
          >
            <div
              data-edge-line
              className={cn(
                "absolute inset-y-0 w-[3px] rounded-full transition-[opacity,background-color] duration-150 motion-reduce:transition-none group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100",
                collapsed ? "left-0" : "left-1/2 -translate-x-1/2",
                dragMode ? "bg-muted-foreground/60 opacity-100" : "bg-separator-strong opacity-0",
              )}
            />
          </div>
        </TooltipTrigger>
        {collapsed && (
          <TooltipContent side="right" className="flex items-center gap-1.5">
            Show playlists
            <Kbd>{IS_MACOS ? "⌘B" : "Ctrl B"}</Kbd>
          </TooltipContent>
        )}
      </Tooltip>
    </motion.div>
  );
}
