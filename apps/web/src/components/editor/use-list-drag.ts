"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { animate, type AnimationPlaybackControls } from "framer-motion";
import { clamp, project, rubberband, velocityFromSamples, type MotionSample } from "@scoutable/shared/lib/motion-math";
import { gapFromPointer, layoutAfterMove, shiftsFrom, type DragLayout, type RowRect } from "@scoutable/shared/lib/list-reorder";
import { springs } from "@/lib/motion";
import { createDragOverlay, type DragOverlay } from "./drag-overlay";

/**
 * Reordering by direct manipulation, the way a list on the Mac or iPhone
 * does it: the row lifts under the pointer and stays glued to it with the
 * grab offset kept; the other rows slide out of the way as the gap moves;
 * past the list's ends the card resists; on release it carries the
 * pointer's velocity into a spring to its slot (a flick lands one slot
 * further), and only then does the order change. A mouse lifts after a
 * short move anywhere on the row; a finger lifts after holding the row's
 * grip (its scroll gesture stays the browser's elsewhere).
 *
 * Nothing re-renders while the pointer moves. Rows are found by
 * `data-row-key`; shifts are written to each row's transform, the card is
 * a portal built in drag-overlay.ts. The commit runs inside flushSync so the
 * DOM holds the new order before the transforms are cleared, so nothing
 * jumps. Esc springs everything back.
 */

export interface ListDropEvent {
  /** The display gap (0..n) the block landed in. */
  gap: number;
  /** Display-ordered keys that moved. */
  blockKeys: string[];
  anchorKey: string;
}

export interface ListDragOptions {
  /** The rows' scroll container (or the element that holds them); rows carry data-row-key. */
  listRef: RefObject<HTMLElement | null>;
  /** False refuses the drag (the caller explains why). */
  canStart: (anchorKey: string) => boolean;
  /** Keys that move with the grabbed row, in display order. */
  blockFor: (anchorKey: string) => string[];
  /** Group-aware correction of a raw gap. */
  snapGap: (gap: number, blockKeys: readonly string[]) => number;
  onDrop: (drop: ListDropEvent) => void;
  /** Fires when a drag starts and when it ends, whatever ended it. */
  onDragStateChange?: (dragging: boolean) => void;
  reducedMotion: boolean;
  /**
   * The list's own focus target (the grid): a press moves focus there, so
   * the keys and assistive tech follow the row that was pressed.
   */
  focusRef?: RefObject<HTMLElement | null>;
}

export interface ListDrag {
  onRowPointerDown: (e: ReactPointerEvent, key: string) => void;
  /** The list changed under a drag: re-measure and carry on. */
  invalidate: () => void;
}

/** A mouse lifts the row after this much travel; less is a click. */
const THRESHOLD_PX = 10;
/** A finger lifts the row after holding its grip this long. */
const HOLD_MS = 300;
const EDGE_PX = 72;
const MAX_SCROLL_PX = 14;
const INTERACTIVE = "button, input, textarea, select, a, [data-no-drag], [role=menu], [role=dialog]";
const GRIP = "[data-drag-grip]";

interface RowEntry {
  key: string;
  el: HTMLElement;
  rect: RowRect;
}

interface Shift {
  current: number;
  target: number;
  anim: AnimationPlaybackControls | null;
}

interface Pending {
  pointerId: number;
  key: string;
  startX: number;
  startY: number;
  rowEl: HTMLElement;
  /** A touch waits for the hold; the timer lifts the row. */
  holdTimer: number | null;
  lastX: number;
  lastY: number;
  timeStamp: number;
}

interface Session {
  pointerId: number;
  anchorKey: string;
  blockKeys: string[];
  blockIndices: number[];
  grabOffsetY: number;
  anchorHeight: number;
  anchorLeft: number;
  /** The anchor row's top relative to the block's first row. */
  anchorOffset: number;
  blockHeight: number;
  rows: RowEntry[];
  shifts: Map<HTMLElement, Shift>;
  hidden: HTMLElement[];
  overlay: DragOverlay;
  samples: MotionSample[];
  last: { x: number; y: number };
  gap: number | null;
  raf: number | null;
  captureEl: Element | null;
  finished: boolean;
}

/** While a row is lifted the whole page shows the grabbing hand and selects no text. */
function setBodyDragging(on: boolean) {
  document.body.style.cursor = on ? "grabbing" : "";
  document.body.style.userSelect = on ? "none" : "";
}

/** The scroll container the rows live in: the list itself when it scrolls, else the window. */
function scrollerOf(list: HTMLElement): { top: number; bottom: number; scrollBy: (dy: number) => number } {
  const r = list.getBoundingClientRect();
  if (list.scrollHeight > list.clientHeight + 1) {
    return {
      top: r.top,
      bottom: r.bottom,
      scrollBy: (dy) => {
        const before = list.scrollTop;
        list.scrollTop += dy;
        return list.scrollTop - before;
      },
    };
  }
  return {
    top: Math.max(r.top, 0),
    bottom: Math.min(r.bottom, window.innerHeight),
    scrollBy: (dy) => {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      return window.scrollY - before;
    },
  };
}

export function useListDrag(options: ListDragOptions): ListDrag {
  // The latest options, read by handlers that outlive the render they were made in.
  const opts = useRef(options);
  useLayoutEffect(() => {
    opts.current = options;
  });
  const pendingRef = useRef<Pending | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const api = useMemo<ListDrag>(() => {
    // ----- measurement -------------------------------------------------------

    function measureRows(list: HTMLElement, shifts?: Map<HTMLElement, Shift>): RowEntry[] {
      const base = list.getBoundingClientRect().top - list.scrollTop;
      return Array.from(list.querySelectorAll<HTMLElement>("[data-row-key]")).map((el) => {
        const r = el.getBoundingClientRect();
        const shift = shifts?.get(el)?.current ?? 0;
        return { key: el.dataset.rowKey ?? "", el, rect: { top: r.top - base - shift, height: r.height } };
      });
    }

    function layoutFor(s: Session, gap: number): DragLayout {
      return layoutAfterMove(
        s.rows.map((r) => r.rect),
        s.blockIndices,
        gap,
      );
    }

    // ----- row shifts ---------------------------------------------------------

    function setShift(s: Session, el: HTMLElement, target: number) {
      let entry = s.shifts.get(el);
      if (!entry) {
        entry = { current: 0, target: 0, anim: null };
        s.shifts.set(el, entry);
      }
      if (entry.target === target) return;
      entry.target = target;
      entry.anim?.stop();
      entry.anim = null;
      const paint = (v: number) => {
        entry!.current = v;
        el.style.transform = v === 0 ? "" : `translateY(${v}px)`;
      };
      if (opts.current.reducedMotion) {
        paint(target);
        return;
      }
      // Each retarget starts from where the row is now, never from where it was going.
      entry.anim = animate(entry.current, target, { ...springs.standard, onUpdate: paint });
    }

    function applyGap(s: Session, gap: number | null) {
      if (s.gap === gap) return;
      s.gap = gap;
      const targets = gap === null ? s.rows.map(() => 0) : shiftsFrom(s.rows.map((r) => r.rect), layoutFor(s, gap));
      s.rows.forEach((row, i) => setShift(s, row.el, targets[i]));
    }

    function clearShifts(s: Session) {
      for (const [el, entry] of s.shifts) {
        entry.anim?.stop();
        el.style.transform = "";
      }
      s.shifts.clear();
      s.gap = null;
    }

    function hideBlock(s: Session) {
      const keys = new Set(s.blockKeys);
      for (const row of s.rows) {
        if (keys.has(row.key)) {
          row.el.style.opacity = "0";
          s.hidden.push(row.el);
        }
      }
    }

    function revealBlock(s: Session) {
      for (const el of s.hidden) el.style.opacity = "";
      s.hidden = [];
    }

    // ----- placement ----------------------------------------------------------

    /** Where the card's top edge is for a pointer at `y`: 1:1 inside the list, resisting past its ends. */
    function cardTopFor(s: Session, list: HTMLElement, y: number): number {
      const r = list.getBoundingClientRect();
      const raw = y - s.grabOffsetY;
      const lo = r.top;
      const hi = Math.max(lo, r.bottom - s.anchorHeight);
      const held = clamp(raw, lo, hi);
      return held + rubberband(raw - held, r.height);
    }

    /**
     * The gap the lifted card is over. It follows the card's centre, not the
     * pointer, so a row grabbed by its edge still opens the gap under the
     * card itself (what UITableView does with the dragged cell).
     */
    function gapAt(s: Session, list: HTMLElement, cardTop: number): number {
      const r = list.getBoundingClientRect();
      const cardCenter = cardTop + s.anchorHeight / 2;
      const raw = gapFromPointer(
        s.rows.map((e) => e.rect),
        cardCenter - r.top + list.scrollTop,
      );
      return opts.current.snapGap(raw, s.blockKeys);
    }

    function update(s: Session, x: number, y: number) {
      s.last = { x, y };
      const list = opts.current.listRef.current;
      if (!list) return;
      const top = cardTopFor(s, list, y);
      s.overlay.move(s.anchorLeft, top);
      applyGap(s, gapAt(s, list, top));
    }

    // Autoscroll while the pointer sits near the scroller's edge; the gap
    // under a still pointer changes with the scroll, so the hit test re-runs.
    function step(s: Session) {
      const list = opts.current.listRef.current;
      if (list) {
        const { x, y } = s.last;
        const scroller = scrollerOf(list);
        let delta = 0;
        if (y < scroller.top + EDGE_PX) delta = -MAX_SCROLL_PX * (1 - clamp((y - scroller.top) / EDGE_PX, 0, 1));
        else if (y > scroller.bottom - EDGE_PX) delta = MAX_SCROLL_PX * (1 - clamp((scroller.bottom - y) / EDGE_PX, 0, 1));
        if (delta !== 0 && scroller.scrollBy(delta) !== 0) {
          // The window moved the list under the card: re-measure its rows.
          if (list.scrollHeight <= list.clientHeight + 1) s.rows = measureRows(list, s.shifts);
          update(s, x, y);
        }
      }
      s.raf = requestAnimationFrame(() => step(s));
    }

    // ----- lifecycle ----------------------------------------------------------

    function teardown(s: Session) {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
      removeWindowListeners();
      window.removeEventListener("keydown", onKey, true);
      try {
        if (s.captureEl && (s.captureEl as HTMLElement).hasPointerCapture?.(s.pointerId)) {
          (s.captureEl as HTMLElement).releasePointerCapture(s.pointerId);
        }
      } catch {
        /* the pointer is gone */
      }
      setBodyDragging(false);
      if (sessionRef.current === s) sessionRef.current = null;
      opts.current.onDragStateChange?.(false);
    }

    /** The click the browser synthesises after pointerup must not select a row. */
    function swallowNextClick() {
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    }

    /** Escape ended the drag but the button is still down: its release is not a click. */
    function swallowClickOnRelease() {
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, true);
      window.addEventListener("pointerup", () => window.setTimeout(() => window.removeEventListener("click", swallow, true), 0), {
        capture: true,
        once: true,
      });
    }

    function commit(s: Session, gap: number) {
      flushSync(() => {
        opts.current.onDrop({ gap, blockKeys: s.blockKeys, anchorKey: s.anchorKey });
      });
      // The DOM now holds the new order at the positions the shifts showed.
      clearShifts(s);
      revealBlock(s);
      s.overlay.remove();
      teardown(s);
    }

    function finish(s: Session, gap: number, velocity: number) {
      const list = opts.current.listRef.current;
      if (!list) return cancel(s);
      applyGap(s, gap);
      const layout = layoutFor(s, gap);
      const landing = list.getBoundingClientRect().top - list.scrollTop + layout.blockTop + s.anchorOffset;
      void s.overlay.settle({ x: s.anchorLeft, y: landing, scale: 1 }, springs.settle, velocity).then(() => {
        if (sessionRef.current === s) commit(s, gap);
      });
    }

    function cancel(s: Session) {
      if (s.finished) return;
      s.finished = true;
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
      applyGap(s, null);
      const list = opts.current.listRef.current;
      const anchor = s.rows.find((r) => r.key === s.anchorKey);
      const settle =
        list && anchor
          ? s.overlay.settle(
              { x: s.anchorLeft, y: list.getBoundingClientRect().top - list.scrollTop + anchor.rect.top, scale: 1 },
              springs.standard,
            )
          : s.overlay.settle({ y: s.overlay.y, scale: 0.96, opacity: 0 }, springs.exit);
      void settle.then(() => {
        if (sessionRef.current !== s) return;
        clearShifts(s);
        revealBlock(s);
        s.overlay.remove();
        teardown(s);
      });
    }

    function release(s: Session, y: number) {
      if (s.finished) return;
      s.finished = true;
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
      swallowNextClick();
      const velocity = velocityFromSamples(s.samples);
      const list = opts.current.listRef.current;
      if (!list) {
        s.finished = false;
        cancel(s);
        return;
      }
      // Land where the flick is going, at most one slot further.
      const projected = y + clamp(project(velocity), -s.anchorHeight, s.anchorHeight);
      finish(s, gapAt(s, list, cardTopFor(s, list, projected)), velocity);
    }

    function start(p: Pending, x: number, y: number, timeStamp: number) {
      const list = opts.current.listRef.current;
      if (!list) return;
      const rows = measureRows(list);
      const anchor = rows.find((r) => r.key === p.key);
      if (!anchor) return;
      const blockKeys = opts.current.blockFor(p.key);
      const keySet = new Set(blockKeys);
      const blockIndices: number[] = [];
      rows.forEach((r, i) => {
        if (keySet.has(r.key)) blockIndices.push(i);
      });
      const blockRows = blockIndices.map((i) => rows[i]);
      const blockHeight = blockRows.reduce((sum, r) => sum + r.rect.height, 0);
      const anchorOffset = blockRows
        .slice(0, blockRows.findIndex((r) => r.key === p.key))
        .reduce((sum, r) => sum + r.rect.height, 0);

      const overlay = createDragOverlay(anchor.el, blockKeys.length, opts.current.reducedMotion);
      const anchorRect = anchor.el.getBoundingClientRect();
      window.getSelection()?.removeAllRanges();
      const s: Session = {
        pointerId: p.pointerId,
        anchorKey: p.key,
        blockKeys,
        blockIndices,
        // The grab offset is where the press landed, so the card never jumps under the pointer.
        grabOffsetY: p.startY - anchorRect.top,
        anchorHeight: anchor.rect.height,
        anchorLeft: anchorRect.left,
        anchorOffset,
        blockHeight,
        rows,
        shifts: new Map(),
        hidden: [],
        overlay,
        samples: [{ t: timeStamp, y }],
        last: { x, y },
        gap: null,
        raf: null,
        captureEl: null,
        finished: false,
      };
      sessionRef.current = s;
      hideBlock(s);
      try {
        p.rowEl.setPointerCapture(p.pointerId);
        s.captureEl = p.rowEl;
        // The row may unmount mid-drag; keep the pointer by moving the capture to the document.
        p.rowEl.addEventListener(
          "lostpointercapture",
          () => {
            if (sessionRef.current !== s || s.finished) return;
            try {
              document.documentElement.setPointerCapture(s.pointerId);
              s.captureEl = document.documentElement;
            } catch {
              s.captureEl = null;
            }
          },
          { once: true },
        );
      } catch {
        s.captureEl = null;
      }
      setBodyDragging(true);
      window.addEventListener("keydown", onKey, true);
      opts.current.onDragStateChange?.(true);
      update(s, x, y);
      s.raf = requestAnimationFrame(() => step(s));
    }

    // ----- window listeners ---------------------------------------------------

    function clearPending() {
      const p = pendingRef.current;
      if (p?.holdTimer !== null && p?.holdTimer !== undefined) window.clearTimeout(p.holdTimer);
      pendingRef.current = null;
      if (!sessionRef.current) removeWindowListeners();
    }

    function onMove(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId !== s.pointerId || s.finished) return;
        e.preventDefault();
        s.samples.push({ t: e.timeStamp, y: e.clientY });
        if (s.samples.length > 16) s.samples.shift();
        update(s, e.clientX, e.clientY);
        return;
      }
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.timeStamp = e.timeStamp;
      const moved = Math.abs(e.clientX - p.startX) >= THRESHOLD_PX || Math.abs(e.clientY - p.startY) >= THRESHOLD_PX;
      if (!moved) return;
      if (p.holdTimer !== null) {
        // A finger that moves before the hold is scrolling, not lifting.
        clearPending();
        return;
      }
      pendingRef.current = null;
      if (!opts.current.canStart(p.key)) {
        removeWindowListeners();
        return;
      }
      start(p, e.clientX, e.clientY, e.timeStamp);
    }

    function onUp(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId !== s.pointerId) return;
        release(s, e.clientY);
        return;
      }
      if (pendingRef.current?.pointerId === e.pointerId) clearPending();
    }

    function onCancelEvent(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId === s.pointerId) cancel(s);
        return;
      }
      if (pendingRef.current?.pointerId === e.pointerId) clearPending();
    }

    function onKey(e: KeyboardEvent) {
      const s = sessionRef.current;
      if (!s || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (!s.finished) swallowClickOnRelease();
      cancel(s);
    }

    function addWindowListeners() {
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancelEvent, true);
    }

    function removeWindowListeners() {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancelEvent, true);
    }

    return {
      onRowPointerDown(e, key) {
        if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        if (sessionRef.current || pendingRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE)) return;
        const touch = e.pointerType === "touch";
        // A finger lifts a row by its grip only; anywhere else it scrolls.
        if (touch && !target.closest(GRIP)) return;
        // No text selection may start from a row; the one default worth
        // keeping, focus leaving a field elsewhere, is done by hand: to the
        // list itself when it has a focus target.
        e.preventDefault();
        const active = document.activeElement as HTMLElement | null;
        const focusTarget = opts.current.focusRef?.current;
        if (focusTarget) {
          if (active !== focusTarget) focusTarget.focus({ preventScroll: true });
        } else if (active && active !== document.body && !e.currentTarget.contains(active)) {
          active.blur();
        }
        const pending: Pending = {
          pointerId: e.pointerId,
          key,
          startX: e.clientX,
          startY: e.clientY,
          rowEl: e.currentTarget as HTMLElement,
          holdTimer: null,
          lastX: e.clientX,
          lastY: e.clientY,
          timeStamp: e.timeStamp,
        };
        if (touch) {
          pending.holdTimer = window.setTimeout(() => {
            const p = pendingRef.current;
            if (p !== pending) return;
            p.holdTimer = null;
            pendingRef.current = null;
            if (!opts.current.canStart(p.key)) {
              removeWindowListeners();
              return;
            }
            // The row lifts under a still finger: the drag starts from where it is.
            start(p, p.lastX, p.lastY, p.timeStamp);
          }, HOLD_MS);
        }
        pendingRef.current = pending;
        addWindowListeners();
      },
      invalidate() {
        const s = sessionRef.current;
        const list = opts.current.listRef.current;
        if (!s || !list || s.finished) return;
        clearShifts(s);
        revealBlock(s);
        s.rows = measureRows(list);
        const keys = new Set(s.blockKeys);
        s.blockIndices = [];
        s.rows.forEach((r, i) => {
          if (keys.has(r.key)) s.blockIndices.push(i);
        });
        if (s.blockIndices.length === 0) {
          cancel(s);
          return;
        }
        hideBlock(s);
        update(s, s.last.x, s.last.y);
      },
    };
  }, []);

  useEffect(
    () => () => {
      const p = pendingRef.current;
      if (p?.holdTimer !== null && p?.holdTimer !== undefined) window.clearTimeout(p.holdTimer);
      pendingRef.current = null;
      const s = sessionRef.current;
      if (s) {
        s.overlay.remove();
        for (const [el] of s.shifts) el.style.transform = "";
        for (const el of s.hidden) el.style.opacity = "";
        if (s.raf !== null) cancelAnimationFrame(s.raf);
        setBodyDragging(false);
        sessionRef.current = null;
      }
    },
    [],
  );

  return api;
}
