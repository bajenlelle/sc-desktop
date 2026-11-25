import * as React from "react";
import { animate, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import {
  clamp,
  project,
  rubberband,
  velocityFromSamples,
  type MotionSample,
} from "@scoutable/shared/lib/motion-math";
import { springs, useReducedMotionSafe } from "@/lib/motion";

export type ColumnLimits = { readonly default: number; readonly min: number; readonly max: number };

/** Movement under this is a click on the edge, not a drag. */
const CLICK_SLOP = 4;
/** How far under the minimum (pull plus flick) a release must head before the column collapses. */
const COLLAPSE_PAST_MIN = 48;
/** Arrow keys move the edge by this much. */
const KEY_STEP = 16;

/**
 * A column resized by its right edge, the way the macOS source lists in Mail and Notes are: the edge follows
 * the pointer 1:1, rubber-bands past the limits and springs back on release with the pointer's velocity; a
 * flick inward (or a pull well under the minimum) collapses it; collapse and expand are one spring of the
 * width, so what sits beside it reflows with the motion. `innerW` keeps the content at its full width while
 * the column animates, so nothing inside re-wraps; while dragged the content follows the edge.
 *
 * `onExpand` turns on the closed column's reveal: its edge pulls it back out 1:1, or opens it with a click.
 * Without it a closed column's edge does nothing (the main sidebar's would be the window's own edge).
 *
 * Shared by the window's sidebar (components/shell/sidebar.tsx) and the playlist browser
 * (components/editor/browser-column.tsx). Each paints its own edge.
 */
export function useColumnResize({
  collapsed,
  width,
  limits,
  onWidthChange,
  onCollapse,
  onExpand,
  onDragStart,
}: {
  collapsed: boolean;
  width: number;
  limits: ColumnLimits;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
  /** Open again at `width`, from the closed column's edge. */
  onExpand?: (width: number) => void;
  onDragStart?: () => void;
}): {
  w: MotionValue<number>;
  innerW: MotionValue<number>;
  dragMode: "resize" | "reveal" | null;
  edgeProps: React.HTMLAttributes<HTMLDivElement> & {
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
  };
} {
  const reduced = useReducedMotionSafe();
  /** A drag on the open column's edge, or a pull on the closed column's edge. */
  const [dragMode, setDragMode] = React.useState<"resize" | "reveal" | null>(null);
  const w = useMotionValue(collapsed ? 0 : width);
  const dragging = React.useRef(false);
  /** The release already started a spring (with the flick's velocity) here. */
  const settlingTo = React.useRef<number | null>(null);
  const widthRef = React.useRef(width);
  widthRef.current = width;
  const innerW = useTransform(w, (v) =>
    dragging.current ? Math.max(v, limits.min) : Math.max(v, widthRef.current),
  );
  /** How far past the minimum a closed column's pull must head before it opens. */
  const revealThreshold = limits.min / 2;

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
    mode: "resize" | "reveal";
    pointerId: number;
    startX: number;
    startWidth: number;
    raw: number;
    moved: boolean;
    samples: MotionSample[];
  } | null>(null);

  function settle(to: number, velocity: number) {
    animate(w, to, reduced ? { duration: 0 } : { ...springs.settle, velocity });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const mode = collapsed ? "reveal" : "resize";
    if (mode === "reveal" && !onExpand) return;
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
    onDragStart?.();
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
    if (raw > limits.max) shown = limits.max + rubberband(raw - limits.max, 240);
    // Pulled out of the edge, the column follows 1:1 from nothing; the open
    // column's edge resists under the minimum instead.
    else if (d.mode === "reveal") shown = Math.max(0, raw);
    else if (raw < limits.min) shown = limits.min + rubberband(raw - limits.min, 240);
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
    const velocity = velocityFromSamples(d.samples, 100, e.timeStamp);
    if (d.mode === "reveal") {
      // A click opens at the width it had; the collapsed effect springs it.
      if (!d.moved) {
        onExpand?.(widthRef.current);
        return;
      }
      // Where the pull was heading decides, as for a collapse: far enough
      // out opens at the dragged width, anything less springs back shut.
      if (d.raw + project(velocity, 0.99) >= revealThreshold) {
        const final = clamp(d.raw, limits.min, limits.max);
        settlingTo.current = final;
        settle(final, velocity);
        onExpand?.(final);
      } else {
        settle(0, velocity);
      }
      return;
    }
    // Where the pull was heading decides: a flick inward, or a pull well
    // under the minimum, collapses. The snappier rate keeps a slow drag that
    // merely dips under the minimum from counting as a flick.
    if (d.raw + project(velocity, 0.99) < limits.min - COLLAPSE_PAST_MIN) {
      onCollapse();
      return;
    }
    const final = clamp(d.raw, limits.min, limits.max);
    if (w.get() !== final) {
      settlingTo.current = final;
      settle(final, velocity);
    }
    onWidthChange(final);
  }

  return {
    w,
    innerW,
    dragMode,
    edgeProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-valuenow": collapsed ? 0 : Math.round(width),
      "aria-valuemin": collapsed ? 0 : limits.min,
      "aria-valuemax": limits.max,
      tabIndex: collapsed && !onExpand ? -1 : 0,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: () => {
        if (!collapsed) onWidthChange(limits.default);
      },
      onKeyDown: (e) => {
        if (collapsed) {
          if (onExpand && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
            e.preventDefault();
            onExpand(widthRef.current);
          }
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onWidthChange(clamp(width - KEY_STEP, limits.min, limits.max));
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onWidthChange(clamp(width + KEY_STEP, limits.min, limits.max));
        }
      },
    },
  };
}
