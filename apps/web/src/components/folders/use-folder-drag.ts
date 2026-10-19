"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { animate, motionValue, type AnimationPlaybackControls, type MotionValue, type Transition } from "framer-motion";
import { clamp, velocityFromSamples } from "@scoutable/shared/lib/motion-math";
import { springs } from "@/lib/motion";

/**
 * Moving playlists and folders by dragging them onto a folder, the way
 * Finder and Files do it. A row lifts after 10 px of travel (a finger holds
 * it still for 300 ms first, so a swipe still scrolls); the lifted card
 * stays under the pointer 1:1 with the grab offset kept, and gathers from
 * the row's width into a compact card so the rows it passes stay readable.
 * A folder under the pointer that can take the item lights up; letting go
 * there hands the pointer's velocity to a spring that lands the card in the
 * folder, and only then does the move happen. Anywhere else, or Esc, springs
 * it back to its row. A finger that held still and lets go gets the row's
 * menu instead, as a long press does on iOS.
 *
 * Nothing re-renders while the pointer moves: the card's position lives in
 * motion values (drag-card.tsx binds them), targets are found with
 * elementFromPoint and marked with an attribute. A drop target is any
 * element with `dropTargetProps(folderId)`; the lifted row gets
 * DRAG_SOURCE_ATTR, the lit target DROP_ACTIVE_ATTR, for their styles.
 */

export interface FolderDragItem {
  kind: "playlist" | "folder";
  id: string;
  /** What the lifted card says. */
  name: string;
  detail?: string;
}

const DROP_ATTR = "data-drop-folder";
const TOP_LEVEL = "top";

/** Marks an element as the place to drop into `folderId` (null: the top level). */
export function dropTargetProps(folderId: string | null): { "data-drop-folder": string } {
  return { [DROP_ATTR]: folderId ?? TOP_LEVEL } as { "data-drop-folder": string };
}

/** On the target under the card while it can take the item, and a moment after it lands. */
export const DROP_ACTIVE_ATTR = "data-drop-active";
/** On the row that was lifted, while its card is up. */
export const DRAG_SOURCE_ATTR = "data-drag-source";

/** The lifted card: what it shows and where it is. */
export interface DragCard {
  item: FolderDragItem;
  height: number;
  x: MotionValue<number>;
  y: MotionValue<number>;
  width: MotionValue<number>;
  scale: MotionValue<number>;
  opacity: MotionValue<number>;
}

export interface FolderDragOptions {
  /** False refuses the drag (a dialog is open, the row is still being saved). */
  canStart: (item: FolderDragItem) => boolean;
  /** Whether `folderId` (null: the top level) may take the item; asked on every hover. */
  canDrop: (item: FolderDragItem, folderId: string | null) => boolean;
  /** The card has landed: move the item. */
  onDrop: (item: FolderDragItem, folderId: string | null) => void;
  /** A touch lifted the row and let go without moving it. */
  onLongPress?: (item: FolderDragItem) => void;
  reducedMotion: boolean;
}

export interface FolderDrag {
  /** The row's onPointerDown; the row element itself is what lifts. */
  onItemPointerDown: (e: ReactPointerEvent<HTMLElement>, item: FolderDragItem) => void;
  /** The lifted card while one is up, for <DragCardView />. */
  card: DragCard | null;
}

/** A mouse lifts the row after this much travel; less is a click. */
const THRESHOLD_PX = 10;
/** A finger lifts the row after holding it this long. */
const HOLD_MS = 300;
/** Autoscroll while the pointer is this close to the window's top or bottom edge. */
const EDGE_PX = 64;
const MAX_SCROLL_PX = 14;
/** The gathered card's width at most. */
const COMPACT_MAX_PX = 260;
/** Once gathered, the pointer sits at least this far inside the card's right edge. */
const COMPACT_GRAB_INSET_PX = 36;
const LIFT_SCALE = 1.02;
/** The card shrinks into the folder it lands in. */
const LANDED_SCALE = 0.55;
/** How long the target stays lit after the card has gone in. */
const LANDED_GLOW_MS = 240;
/** Over a target the card thins, so the lit target shows through it (a path step sits right under the pointer). */
const OVER_TARGET_OPACITY = 0.6;
const INTERACTIVE = "button, input, textarea, select, a, [data-no-drag], [role=menu], [role=dialog]";

interface Pending {
  pointerId: number;
  item: FolderDragItem;
  el: HTMLElement;
  touch: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  t: number;
  /** A touch waits for the hold; the timer lifts the row. */
  holdTimer: number | null;
}

interface Target {
  el: HTMLElement;
  folderId: string | null;
}

interface Session {
  pointerId: number;
  item: FolderDragItem;
  el: HTMLElement;
  touch: boolean;
  row: { left: number; top: number; width: number };
  grabX: number;
  grabY: number;
  compactWidth: number;
  /** 0 = the card is the row's width, 1 = gathered. */
  morph: number;
  anims: AnimationPlaybackControls[];
  lift: { x: number; y: number };
  /** Travelled past the threshold since it lifted (a touch that didn't is a long press). */
  moved: boolean;
  samples: Array<{ t: number; x: number; y: number }>;
  last: { x: number; y: number };
  target: Target | null;
  raf: number | null;
  captureEl: Element | null;
  finished: boolean;
  card: DragCard;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** While a card is up the whole page shows the grabbing hand and selects no text. */
function setBodyDragging(on: boolean) {
  document.body.style.cursor = on ? "grabbing" : "";
  document.body.style.userSelect = on ? "none" : "";
}

/** The click the browser synthesises after pointerup must not open the row. */
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

export function useFolderDrag(options: FolderDragOptions): FolderDrag {
  // The latest options, read by handlers that outlive the render they were made in.
  const opts = useRef(options);
  useLayoutEffect(() => {
    opts.current = options;
  });
  const pendingRef = useRef<Pending | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [card, setCard] = useState<DragCard | null>(null);

  const api = useMemo(() => {
    // ----- the card ------------------------------------------------------------

    /** The card under the pointer: 1:1, with the grab offset easing in as it gathers. */
    function place(s: Session) {
      const m = s.morph;
      const grabX = lerp(s.grabX, Math.min(s.grabX, s.compactWidth - COMPACT_GRAB_INSET_PX), m);
      s.card.x.set(s.last.x - grabX);
      s.card.y.set(s.last.y - s.grabY);
      s.card.width.set(lerp(s.row.width, s.compactWidth, m));
    }

    function run(s: Session, mv: MotionValue<number>, to: number, transition: Transition, velocity?: number): Promise<void> {
      return new Promise((resolve) => {
        if (mv.get() === to) {
          resolve();
          return;
        }
        s.anims.push(animate(mv, to, { ...transition, velocity, onComplete: () => resolve() }));
      });
    }

    function stopAnims(s: Session) {
      for (const a of s.anims) a.stop();
      s.anims = [];
    }

    // ----- targets -------------------------------------------------------------

    function setTarget(s: Session, next: Target | null) {
      if (s.target?.el === next?.el) {
        s.target = next;
        return;
      }
      s.target?.el.removeAttribute(DROP_ACTIVE_ATTR);
      next?.el.setAttribute(DROP_ACTIVE_ATTR, "");
      s.target = next;
      if (!s.finished) void run(s, s.card.opacity, next ? OVER_TARGET_OPACITY : 1, { duration: 0.12, ease: "easeOut" });
    }

    function hitTest(s: Session) {
      const under = document.elementFromPoint(s.last.x, s.last.y);
      const el = under ? under.closest<HTMLElement>(`[${DROP_ATTR}]`) : null;
      if (!el) {
        setTarget(s, null);
        return;
      }
      const raw = el.getAttribute(DROP_ATTR);
      const folderId = raw === null || raw === TOP_LEVEL ? null : raw;
      setTarget(s, opts.current.canDrop(s.item, folderId) ? { el, folderId } : null);
    }

    // Autoscroll near the window's edges, unless the pointer is on a target
    // (the toolbar's path sits in the top band). The rows move under a still
    // pointer as the page scrolls, so the hit test runs again.
    function step(s: Session) {
      const { y } = s.last;
      let delta = 0;
      if (!s.target) {
        if (y < EDGE_PX) delta = -MAX_SCROLL_PX * (1 - clamp(y / EDGE_PX, 0, 1));
        else if (y > window.innerHeight - EDGE_PX) delta = MAX_SCROLL_PX * (1 - clamp((window.innerHeight - y) / EDGE_PX, 0, 1));
      }
      if (delta !== 0) {
        const before = window.scrollY;
        window.scrollBy(0, delta);
        if (window.scrollY !== before) hitTest(s);
      }
      s.raf = requestAnimationFrame(() => step(s));
    }

    function stopFrame(s: Session) {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
    }

    // ----- lifecycle -----------------------------------------------------------

    function start(p: Pending, x: number, y: number, t: number) {
      const rect = p.el.getBoundingClientRect();
      const reduced = opts.current.reducedMotion;
      const compactWidth = Math.min(rect.width, COMPACT_MAX_PX);
      const card: DragCard = {
        item: p.item,
        height: rect.height,
        x: motionValue(rect.left),
        y: motionValue(rect.top),
        width: motionValue(rect.width),
        scale: motionValue(1),
        opacity: motionValue(1),
      };
      const s: Session = {
        pointerId: p.pointerId,
        item: p.item,
        el: p.el,
        touch: p.touch,
        row: { left: rect.left, top: rect.top, width: rect.width },
        // The grab offset is where the press landed, so the card never jumps under the pointer.
        grabX: p.startX - rect.left,
        grabY: p.startY - rect.top,
        compactWidth,
        // Reduced motion: the card is gathered from the start rather than morphing.
        morph: reduced ? 1 : 0,
        anims: [],
        lift: { x, y },
        moved: false,
        samples: [{ t, x, y }],
        last: { x, y },
        target: null,
        raf: null,
        captureEl: null,
        finished: false,
        card,
      };
      sessionRef.current = s;
      place(s);
      p.el.setAttribute(DRAG_SOURCE_ATTR, "");
      window.getSelection()?.removeAllRanges();
      try {
        p.el.setPointerCapture(p.pointerId);
        s.captureEl = p.el;
        // The row may unmount mid-drag; keep the pointer by moving the capture to the document.
        p.el.addEventListener(
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
      addSessionListeners();
      setCard(card);
      if (!reduced) {
        s.anims.push(
          animate(0, 1, {
            ...springs.standard,
            onUpdate: (m) => {
              s.morph = m;
              if (!s.finished) place(s);
            },
          }),
        );
        s.anims.push(animate(card.scale, LIFT_SCALE, springs.snappy));
      }
      hitTest(s);
      s.raf = requestAnimationFrame(() => step(s));
    }

    function teardown(s: Session) {
      stopFrame(s);
      removePointerListeners();
      removeSessionListeners();
      try {
        if (s.captureEl && (s.captureEl as HTMLElement).hasPointerCapture?.(s.pointerId)) {
          (s.captureEl as HTMLElement).releasePointerCapture(s.pointerId);
        }
      } catch {
        /* the pointer is gone */
      }
      setBodyDragging(false);
      if (sessionRef.current === s) sessionRef.current = null;
    }

    /** The card is gone: clean up, and move the item when it landed. */
    function end(s: Session, landed: Target | null) {
      teardown(s);
      const { item, el } = s;
      if (landed) {
        // The folder stays lit a moment, so it reads as where the item went;
        // the source row is on its way out and stays dimmed while it leaves.
        window.setTimeout(() => landed.el.removeAttribute(DROP_ACTIVE_ATTR), LANDED_GLOW_MS);
        window.setTimeout(() => el.removeAttribute(DRAG_SOURCE_ATTR), 700);
      } else {
        s.target?.el.removeAttribute(DROP_ACTIVE_ATTR);
        el.removeAttribute(DRAG_SOURCE_ATTR);
      }
      setCard(null);
      if (landed) opts.current.onDrop(item, landed.folderId);
    }

    /** Into the folder: the release velocity carries into a spring per axis, the card shrinks and fades into it. */
    function land(s: Session, target: Target) {
      const finish = () => end(s, target);
      if (opts.current.reducedMotion) {
        void run(s, s.card.opacity, 0, { duration: 0.12, ease: "easeOut" }).then(finish);
        return;
      }
      const r = target.el.getBoundingClientRect();
      const vx = velocityFromSamples(s.samples.map((p) => ({ t: p.t, y: p.x })));
      const vy = velocityFromSamples(s.samples.map((p) => ({ t: p.t, y: p.y })));
      void run(s, s.card.x, r.left + Math.min(12, r.width / 4), springs.settle, vx);
      void run(s, s.card.y, r.top + (r.height - s.card.height) / 2, springs.settle, vy);
      void run(s, s.card.scale, LANDED_SCALE, springs.settle);
      // Done once it has faded: the rest of the spring would move nothing visible.
      void run(s, s.card.opacity, 0, { duration: 0.22, delay: 0.08, ease: "easeIn" }).then(finish);
    }

    /** Back to the row it came from; a row that is gone meanwhile just fades. */
    function settleBack(s: Session) {
      const finish = () => end(s, null);
      if (opts.current.reducedMotion) {
        void run(s, s.card.opacity, 0, { duration: 0.12, ease: "easeOut" }).then(finish);
        return;
      }
      if (!s.el.isConnected) {
        void run(s, s.card.scale, 0.96, springs.exit);
        void run(s, s.card.opacity, 0, springs.exit).then(finish);
        return;
      }
      const r = s.el.getBoundingClientRect();
      void Promise.all([
        run(s, s.card.x, r.left, springs.standard),
        run(s, s.card.y, r.top, springs.standard),
        run(s, s.card.width, r.width, springs.standard),
        run(s, s.card.scale, 1, springs.standard),
      ]).then(finish);
    }

    function release(s: Session) {
      if (s.finished) return;
      s.finished = true;
      stopFrame(s);
      stopAnims(s);
      swallowNextClick();
      if (s.touch && !s.moved && !s.target) {
        // A long press, not a drag: the menu opens at once, the card goes home under it.
        opts.current.onLongPress?.(s.item);
        settleBack(s);
        return;
      }
      const target = s.target;
      if (target && target.el.isConnected && opts.current.canDrop(s.item, target.folderId)) land(s, target);
      else settleBack(s);
    }

    function cancel(s: Session) {
      if (s.finished) return;
      s.finished = true;
      stopFrame(s);
      stopAnims(s);
      setTarget(s, null);
      settleBack(s);
    }

    // ----- window listeners ----------------------------------------------------

    function clearPending() {
      const p = pendingRef.current;
      if (p?.holdTimer !== null && p?.holdTimer !== undefined) window.clearTimeout(p.holdTimer);
      pendingRef.current = null;
      if (!sessionRef.current) removePointerListeners();
    }

    function onMove(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId !== s.pointerId || s.finished) return;
        e.preventDefault();
        s.last = { x: e.clientX, y: e.clientY };
        s.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
        if (s.samples.length > 16) s.samples.shift();
        if (!s.moved && Math.hypot(e.clientX - s.lift.x, e.clientY - s.lift.y) >= THRESHOLD_PX) s.moved = true;
        place(s);
        hitTest(s);
        return;
      }
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.t = e.timeStamp;
      const moved = Math.abs(e.clientX - p.startX) >= THRESHOLD_PX || Math.abs(e.clientY - p.startY) >= THRESHOLD_PX;
      if (!moved) return;
      if (p.touch) {
        // A finger that moves before the hold is scrolling, not lifting.
        clearPending();
        return;
      }
      pendingRef.current = null;
      if (!opts.current.canStart(p.item)) {
        removePointerListeners();
        return;
      }
      start(p, e.clientX, e.clientY, e.timeStamp);
    }

    function onUp(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId === s.pointerId) release(s);
        return;
      }
      if (pendingRef.current?.pointerId === e.pointerId) clearPending();
    }

    function onPointerCancel(e: PointerEvent) {
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

    function onBlur() {
      const s = sessionRef.current;
      if (s) cancel(s);
    }

    /** While a card is up a finger drags it instead of scrolling the page. */
    function onTouchMove(e: TouchEvent) {
      if (sessionRef.current) e.preventDefault();
    }

    /** No context menu (or Android's long-press menu) in the middle of a drag. */
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
    }

    function addPointerListeners() {
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
    }

    function removePointerListeners() {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    }

    function addSessionListeners() {
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onBlur);
      window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
      window.addEventListener("contextmenu", onContextMenu, true);
    }

    function removeSessionListeners() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    }

    return {
      onItemPointerDown(e: ReactPointerEvent<HTMLElement>, item: FolderDragItem) {
        if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        if (sessionRef.current || pendingRef.current) return;
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        if (!opts.current.canStart(item)) return;
        const touch = e.pointerType === "touch";
        const pending: Pending = {
          pointerId: e.pointerId,
          item,
          el: e.currentTarget,
          touch,
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          t: e.timeStamp,
          holdTimer: null,
        };
        if (touch) {
          pending.holdTimer = window.setTimeout(() => {
            const p = pendingRef.current;
            if (p !== pending) return;
            p.holdTimer = null;
            pendingRef.current = null;
            if (!opts.current.canStart(p.item)) {
              removePointerListeners();
              return;
            }
            // The row lifts under a still finger: the drag starts from where it is.
            start(p, p.lastX, p.lastY, p.t);
          }, HOLD_MS);
        }
        pendingRef.current = pending;
        addPointerListeners();
      },
      unmount() {
        const p = pendingRef.current;
        if (p?.holdTimer !== null && p?.holdTimer !== undefined) window.clearTimeout(p.holdTimer);
        pendingRef.current = null;
        removePointerListeners();
        const s = sessionRef.current;
        if (s) {
          stopAnims(s);
          s.target?.el.removeAttribute(DROP_ACTIVE_ATTR);
          s.el.removeAttribute(DRAG_SOURCE_ATTR);
          teardown(s);
        }
      },
    };
  }, []);

  useEffect(() => () => api.unmount(), [api]);

  return { onItemPointerDown: api.onItemPointerDown, card };
}
