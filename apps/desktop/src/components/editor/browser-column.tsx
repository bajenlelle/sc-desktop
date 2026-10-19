import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import {
  clamp,
  project,
  rubberband,
  velocityFromSamples,
  type MotionSample,
} from "@scoutable/shared/lib/motion-math";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const BROWSER_WIDTH = { default: 260, min: 200, max: 480 } as const;

/**
 * The playlist browser's column: resized 1:1 by its edge, rubber-banding
 * past its limits and springing back on release; a flick inward (or a pull
 * well past the minimum) collapses it, and collapse/expand is one spring of
 * the width so the editor beside it reflows with the motion. The content
 * keeps its full width while the column animates, so nothing inside
 * re-wraps.
 */
export function BrowserColumn({
  collapsed,
  width,
  onWidthChange,
  onCollapse,
  className,
  children,
}: {
  collapsed: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotionSafe();
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
    pointerId: number;
    startX: number;
    startWidth: number;
    raw: number;
    samples: MotionSample[];
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || collapsed) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: width,
      raw: width,
      samples: [{ t: e.timeStamp, y: e.clientX }],
    };
    document.body.style.cursor = "col-resize";
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const raw = d.startWidth + (e.clientX - d.startX);
    d.raw = raw;
    d.samples.push({ t: e.timeStamp, y: e.clientX });
    if (d.samples.length > 16) d.samples.shift();
    let shown = raw;
    if (raw < BROWSER_WIDTH.min) shown = BROWSER_WIDTH.min + rubberband(raw - BROWSER_WIDTH.min, 240);
    else if (raw > BROWSER_WIDTH.max) shown = BROWSER_WIDTH.max + rubberband(raw - BROWSER_WIDTH.max, 240);
    w.set(shown);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    dragging.current = false;
    document.body.style.cursor = "";
    try {
      e.currentTarget.releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    const velocity = velocityFromSamples(d.samples);
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

  return (
    <motion.div
      style={{ width: w }}
      aria-hidden={collapsed || undefined}
      className={cn("relative h-full shrink-0 overflow-hidden select-none", className)}
    >
      <motion.div style={{ width: innerW }} className="flex h-full flex-col">
        {children}
      </motion.div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the playlist browser"
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
        className="group/sep absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize outline-none"
      >
        <div className="absolute inset-y-0 right-0 w-px bg-separator transition-[background-color,width] duration-150 group-hover/sep:w-0.5 group-hover/sep:bg-selection group-focus-visible/sep:w-0.5 group-focus-visible/sep:bg-selection" />
      </div>
    </motion.div>
  );
}
