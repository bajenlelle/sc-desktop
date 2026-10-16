import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import {
  clamp,
  project,
  rubberband,
  velocityFromSamples,
  type MotionSample,
} from "@scoutable/shared/lib/motion-math";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

export const BROWSER_WIDTH = { default: 260, min: 200, max: 480 } as const;

/** How far a pull on the closed browser's grip must head before it opens. */
const REVEAL_THRESHOLD = BROWSER_WIDTH.min / 2;
/** Movement under this is a click on the grip, not a drag. */
const CLICK_SLOP = 4;

/**
 * The playlist browser's column: resized 1:1 by its edge, rubber-banding
 * past its limits and springing back on release; a flick inward (or a pull
 * well past the minimum) collapses it, and collapse/expand is one spring of
 * the width so the editor beside it reflows with the motion. The content
 * keeps its full width while the column animates, so nothing inside
 * re-wraps. Closed, a grip on the editor's left edge (Claude's sidebar
 * has one) pulls it back out 1:1, or opens it with a click.
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
  const reduced = useReducedMotionSafe();
  /** A drag on the open browser's edge, or a pull on the closed browser's grip. */
  const [dragMode, setDragMode] = React.useState<"resize" | "reveal" | null>(null);
  const w = useMotionValue(collapsed ? 0 : width);
  const dragging = React.useRef(false);
  /** The release already started a spring (with the flick's velocity) here. */
  const settlingTo = React.useRef<number | null>(null);
  const widthRef = React.useRef(width);
  widthRef.current = width;
  const innerW = useTransform(w, (v) =>
    dragging.current ? Math.max(v, BROWSER_WIDTH.min) : Math.max(v, widthRef.current),
  );

  React.useEffect(() => {
    if (dragging.current) return;
    const target = collapsed ? 0 : width;
    // Cleared on every run: a release that kept the width never re-runs
    // this effect, and a stale value must not swallow the next expand.
    const releaseSpringRunning = settlingTo.current === target;
    settlingTo.current = null;
    if (releaseSpringRunning) return;
    if (reduced) {
      w.set(target);
      return;
    }
    const controls = animate(w, target, springs.standard);
    return () => controls.stop();
  }, [collapsed, width, reduced, w]);

  const drag = React.useRef<{
    /** resize: the open browser's edge. reveal: the closed browser's grip. */
    mode: "resize" | "reveal";
    pointerId: number;
    startX: number;
    startWidth: number;
    raw: number;
    moved: boolean;
    samples: MotionSample[];
  } | null>(null);

  function startDrag(e: React.PointerEvent<HTMLDivElement>, mode: "resize" | "reveal") {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const startWidth = mode === "reveal" ? 0 : width;
    drag.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth,
      raw: startWidth,
      moved: false,
      samples: [{ t: e.timeStamp, y: e.clientX }],
    };
    document.body.style.cursor = "col-resize";
    setDragMode(mode);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || collapsed) return;
    startDrag(e, "resize");
  }

  function onGripPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !collapsed) return;
    startDrag(e, "reveal");
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const raw = d.startWidth + (e.clientX - d.startX);
    d.raw = raw;
    if (Math.abs(e.clientX - d.startX) >= CLICK_SLOP) d.moved = true;
    d.samples.push({ t: e.timeStamp, y: e.clientX });
    if (d.samples.length > 16) d.samples.shift();
    let shown = raw;
    if (raw > BROWSER_WIDTH.max) shown = BROWSER_WIDTH.max + rubberband(raw - BROWSER_WIDTH.max, 240);
    // Pulled out of the edge, the browser follows 1:1 from nothing; the open
    // browser's edge resists under the minimum instead.
    else if (d.mode === "reveal") shown = Math.max(0, raw);
    else if (raw < BROWSER_WIDTH.min) shown = BROWSER_WIDTH.min + rubberband(raw - BROWSER_WIDTH.min, 240);
    w.set(shown);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    dragging.current = false;
    setDragMode(null);
    document.body.style.cursor = "";
    try {
      e.currentTarget.releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    const velocity = velocityFromSamples(d.samples);
    if (d.mode === "reveal") {
      // A click opens at the width it had; the collapsed effect springs it.
      if (!d.moved) {
        onExpand(widthRef.current);
        return;
      }
      // Where the pull was heading decides, as for a collapse: far enough
      // out opens at the dragged width, anything less springs back shut.
      if (d.raw + project(velocity, 0.99) >= REVEAL_THRESHOLD) {
        const final = clamp(d.raw, BROWSER_WIDTH.min, BROWSER_WIDTH.max);
        settlingTo.current = final;
        animate(w, final, reduced ? { duration: 0 } : { ...springs.settle, velocity });
        onExpand(final);
      } else {
        animate(w, 0, reduced ? { duration: 0 } : { ...springs.settle, velocity });
      }
      return;
    }
    // Where the pull was heading decides: a flick inward, or a pull well
    // under the minimum, collapses. The snappier rate keeps a slow drag that
    // merely dips under the minimum from counting as a flick.
    if (d.raw + project(velocity, 0.99) < BROWSER_WIDTH.min - 48) {
      onCollapse();
      return;
    }
    const final = clamp(d.raw, BROWSER_WIDTH.min, BROWSER_WIDTH.max);
    if (w.get() !== final) {
      settlingTo.current = final;
      animate(w, final, reduced ? { duration: 0 } : { ...springs.settle, velocity });
    }
    onWidthChange(final);
  }

  const showGrip = collapsed || dragMode === "reveal";

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
      {/* Open: the whole edge resizes it, grabbed at any height. It
          straddles the divider; hovering or dragging shows the closed
          grip's pill, centred on the line, instead of a highlight. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the playlist browser"
        aria-hidden={collapsed || undefined}
        aria-valuenow={Math.round(width)}
        aria-valuemin={BROWSER_WIDTH.min}
        aria-valuemax={BROWSER_WIDTH.max}
        tabIndex={collapsed ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onWidthChange(BROWSER_WIDTH.default)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onWidthChange(clamp(width - 16, BROWSER_WIDTH.min, BROWSER_WIDTH.max));
          if (e.key === "ArrowRight") onWidthChange(clamp(width + 16, BROWSER_WIDTH.min, BROWSER_WIDTH.max));
        }}
        className={cn(
          "group/sep absolute inset-y-0 -right-1.5 z-20 flex w-3 cursor-col-resize items-center justify-center outline-none",
          collapsed && "pointer-events-none",
        )}
      >
        <div
          className={cn(
            "h-9 w-[5px] rounded-full bg-foreground/40 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/sep:opacity-100 group-focus-visible/sep:bg-selection group-focus-visible/sep:opacity-100",
            dragMode === "resize" && "opacity-100",
          )}
        />
      </div>
      {/* Closed: a grip on the browser's edge (the editor's left edge),
          riding it while it is pulled back out. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Show the playlist browser"
            aria-hidden={!showGrip || undefined}
            aria-valuenow={0}
            aria-valuemin={0}
            aria-valuemax={BROWSER_WIDTH.max}
            tabIndex={showGrip ? 0 : -1}
            onPointerDown={onGripPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
                e.preventDefault();
                onExpand(widthRef.current);
              }
            }}
            className={cn(
              "group/grip absolute inset-y-0 left-full z-20 flex w-3 cursor-col-resize items-center justify-center outline-none transition-opacity duration-200 motion-reduce:transition-none",
              showGrip ? "opacity-100 delay-150" : "pointer-events-none opacity-0",
            )}
          >
            <div className="h-9 w-1 rounded-full bg-foreground/20 transition-[background-color,width] duration-150 group-hover/grip:w-[5px] group-hover/grip:bg-foreground/40 group-focus-visible/grip:w-[5px] group-focus-visible/grip:bg-selection" />
          </div>
        </TooltipTrigger>
        {showGrip && (
          <TooltipContent side="right" className="flex items-center gap-1.5">
            Show playlists
            <Kbd>{IS_MACOS ? "\u2318B" : "Ctrl B"}</Kbd>
          </TooltipContent>
        )}
      </Tooltip>
    </motion.div>
  );
}
