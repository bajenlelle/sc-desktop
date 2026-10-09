import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { animate, type AnimationPlaybackControls } from "framer-motion";
import { clamp, project, velocityFromSamples, type MotionSample } from "@scoutable/shared/lib/motion-math";
import {
  gapFromPointer,
  layoutAfterInsert,
  layoutAfterMove,
  shiftsFrom,
  type DragLayout,
  type RowRect,
} from "@scoutable/shared/lib/list-reorder";
import { springs } from "@/lib/motion";
import { createDragOverlay, type DragOverlay } from "./drag-overlay";

/**
 * Reordering by direct manipulation, the way a list on the Mac or iPhone
 * does it: the row lifts under the pointer and stays glued to it with the
 * grab offset kept; the other rows slide out of the way as the gap moves;
 * on release the card carries the pointer's velocity into a spring to its
 * slot (a flick lands one slot further), and only then does the order
 * change. The sidebar is a second target: hovering a playlist highlights
 * and spring-loads it, dropping there copies the clip.
 *
 * Nothing re-renders while the pointer moves. Rows are found by
 * `data-row-key`, sidebar targets by `data-playlist-id` / `data-folder-id`;
 * shifts are written to each row's transform, the card is a portal built in
 * drag-overlay.ts. The commit runs inside flushSync so the DOM holds the new
 * order before the transforms are cleared, so nothing jumps.
 */

export type DragTarget =
  | { kind: "list"; gap: number }
  | { kind: "playlist"; id: string }
  | { kind: "folder"; id: string }
  | { kind: "none" };

export interface ListDropEvent {
  gap: number;
  /** Display-ordered keys that moved; empty for a foreign clip. */
  blockKeys: string[];
  anchorKey: string;
  /** The block no longer exists in the list (spring-loaded elsewhere). */
  foreign: boolean;
}

export interface ListDragOptions {
  /** The rows' scroll container; rows carry data-row-key. */
  listRef: RefObject<HTMLElement | null>;
  /** The browser column's scroll container: rows carry data-playlist-id / data-folder-id. */
  sidebarRef: RefObject<HTMLElement | null>;
  /** False refuses the drag (the caller explains why). */
  canStart: (anchorKey: string) => boolean;
  /** Keys that move with the grabbed row, in display order. */
  blockFor: (anchorKey: string) => string[];
  /** Group-aware correction of a raw gap. */
  snapGap: (gap: number, blockKeys: readonly string[]) => number;
  /** Fires only when the target changes. */
  onTarget: (target: DragTarget) => void;
  onDrop: (drop: ListDropEvent) => void;
  onDropOnPlaylist: (playlistId: string, anchorKey: string) => void;
  /** Always fires last, whatever ended the drag. */
  onEnd: () => void;
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

const THRESHOLD_PX = 4;
const EDGE_PX = 72;
const MAX_SCROLL_PX = 14;
const INTERACTIVE = "button, input, textarea, select, a, [data-no-drag], [role=menu], [role=dialog]";

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
}

interface Session {
  pointerId: number;
  anchorKey: string;
  blockKeys: string[];
  blockIndices: number[];
  foreign: boolean;
  grabOffsetX: number;
  grabOffsetY: number;
  anchorHeight: number;
  /** The column the card belongs to; it stays there while over the list. */
  anchorLeft: number;
  /** Where the pointer would put the card's left edge. */
  freeX: number;
  /** Card x: anchorLeft while over the list, freeX elsewhere, eased between. */
  x: number;
  xOffset: number;
  locked: boolean;
  /** The anchor row's top relative to the block's first row. */
  anchorOffset: number;
  blockHeight: number;
  rows: RowEntry[];
  shifts: Map<HTMLElement, Shift>;
  hidden: HTMLElement[];
  overlay: DragOverlay;
  samples: MotionSample[];
  last: { x: number; y: number };
  target: DragTarget;
  gap: number | null;
  raf: number | null;
  captureEl: Element | null;
  finished: boolean;
}

function sameTarget(a: DragTarget, b: DragTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "list" && b.kind === "list") return a.gap === b.gap;
  if ((a.kind === "playlist" && b.kind === "playlist") || (a.kind === "folder" && b.kind === "folder")) {
    return a.id === b.id;
  }
  return true;
}

function inside(r: DOMRect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function useListDrag(options: ListDragOptions): ListDrag {
  const opts = useRef(options);
  opts.current = options;
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
      const rects = s.rows.map((r) => r.rect);
      return s.foreign ? layoutAfterInsert(rects, gap, s.blockHeight) : layoutAfterMove(rects, s.blockIndices, gap);
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
      entry.anim = animate(entry.current, target, { ...springs.standard, onUpdate: paint });
    }

    function applyGap(s: Session, gap: number | null) {
      if (s.gap === gap) return;
      s.gap = gap;
      const targets =
        gap === null ? s.rows.map(() => 0) : shiftsFrom(s.rows.map((r) => r.rect), layoutFor(s, gap));
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

    // ----- hit testing --------------------------------------------------------

    /**
     * The gap the lifted card is over. It follows the card's centre, not the
     * pointer, so a row grabbed by its edge still opens the gap under the
     * card itself (what UITableView does with the dragged cell).
     */
    function gapAt(s: Session, list: HTMLElement, pointerY: number): number {
      const r = list.getBoundingClientRect();
      const cardCenter = pointerY - s.grabOffsetY + s.anchorHeight / 2;
      const raw = gapFromPointer(
        s.rows.map((e) => e.rect),
        cardCenter - r.top + list.scrollTop,
      );
      return opts.current.snapGap(raw, s.blockKeys);
    }

    function hitTest(s: Session, x: number, y: number): DragTarget {
      const list = opts.current.listRef.current;
      if (list && inside(list.getBoundingClientRect(), x, y)) {
        return { kind: "list", gap: gapAt(s, list, y) };
      }
      const side = opts.current.sidebarRef.current;
      if (side && inside(side.getBoundingClientRect(), x, y)) {
        for (const el of side.querySelectorAll<HTMLElement>("[data-playlist-id], [data-folder-id]")) {
          if (!inside(el.getBoundingClientRect(), x, y)) continue;
          if (el.dataset.playlistId) return { kind: "playlist", id: el.dataset.playlistId };
          if (el.dataset.folderId) return { kind: "folder", id: el.dataset.folderId };
        }
      }
      return { kind: "none" };
    }

    function placeCard(s: Session) {
      s.x = (s.locked ? s.anchorLeft : s.freeX) + s.xOffset;
      s.overlay.move(s.x, s.last.y - s.grabOffsetY);
    }

    function update(s: Session, x: number, y: number) {
      s.last = { x, y };
      s.freeX = x - s.grabOffsetX;
      const target = hitTest(s, x, y);
      // Over the list the card sits in its column; anywhere else it is in
      // the hand. Switching keeps the card where it is and eases the rest.
      const locked = target.kind === "list";
      if (locked !== s.locked) {
        s.xOffset = s.x - (locked ? s.anchorLeft : s.freeX);
        s.locked = locked;
        s.overlay.setFloating(!locked);
      }
      placeCard(s);
      applyGap(s, target.kind === "list" ? target.gap : null);
      if (!sameTarget(target, s.target)) {
        s.target = target;
        opts.current.onTarget(target);
      }
    }

    // Autoscroll either container while the pointer sits near its edge; the
    // hit test re-runs after a scroll because the gap under a still pointer
    // changes with it.
    function step(s: Session) {
      const { x, y } = s.last;
      for (const el of [opts.current.listRef.current, opts.current.sidebarRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (!inside(r, x, y) || el.scrollHeight <= el.clientHeight) continue;
        let delta = 0;
        if (y < r.top + EDGE_PX) delta = -MAX_SCROLL_PX * (1 - (y - r.top) / EDGE_PX);
        else if (y > r.bottom - EDGE_PX) delta = MAX_SCROLL_PX * (1 - (r.bottom - y) / EDGE_PX);
        if (delta === 0) continue;
        const before = el.scrollTop;
        el.scrollTop += delta;
        if (el.scrollTop !== before) update(s, x, y);
      }
      if (s.xOffset !== 0) {
        s.xOffset = Math.abs(s.xOffset) < 0.5 ? 0 : s.xOffset * 0.72;
        placeCard(s);
      }
      s.raf = requestAnimationFrame(() => step(s));
    }

    // ----- lifecycle ----------------------------------------------------------

    function teardown(s: Session) {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancelEvent, true);
      window.removeEventListener("keydown", onKey, true);
      try {
        if (s.captureEl && (s.captureEl as HTMLElement).hasPointerCapture?.(s.pointerId)) {
          (s.captureEl as HTMLElement).releasePointerCapture(s.pointerId);
        }
      } catch {
        /* the pointer is gone */
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (sessionRef.current === s) sessionRef.current = null;
      opts.current.onEnd();
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
      window.addEventListener(
        "pointerup",
        () => window.setTimeout(() => window.removeEventListener("click", swallow, true), 0),
        { capture: true, once: true },
      );
    }

    function commitList(s: Session, gap: number) {
      flushSync(() => {
        opts.current.onDrop({ gap, blockKeys: s.blockKeys, anchorKey: s.anchorKey, foreign: s.foreign });
      });
      // The DOM now holds the new order at the positions the shifts showed.
      clearShifts(s);
      revealBlock(s);
      s.overlay.remove();
      teardown(s);
    }

    function finishInList(s: Session, gap: number, velocity: number) {
      const list = opts.current.listRef.current;
      if (!list) return cancel(s);
      applyGap(s, gap);
      const layout = layoutFor(s, gap);
      const landing = list.getBoundingClientRect().top - list.scrollTop + layout.blockTop + s.anchorOffset;
      void s.overlay.settle({ x: s.anchorLeft, y: landing, scale: 1 }, springs.settle, velocity).then(() => {
        if (sessionRef.current === s) commitList(s, gap);
      });
    }

    function finishOnPlaylist(s: Session, playlistId: string) {
      // Data first, then the card shrinks into the row it landed on.
      opts.current.onDropOnPlaylist(playlistId, s.anchorKey);
      const side = opts.current.sidebarRef.current;
      const row = side?.querySelector<HTMLElement>(`[data-playlist-id="${CSS.escape(playlistId)}"]`);
      const rowRect = row?.getBoundingClientRect();
      const to = rowRect
        ? { x: rowRect.left, y: rowRect.top, scale: 0.35, opacity: 0 }
        : { y: s.overlay.y, scale: 0.35, opacity: 0 };
      void s.overlay.settle(to, springs.standard).then(() => {
        if (sessionRef.current !== s) return;
        revealBlock(s);
        s.overlay.remove();
        teardown(s);
      });
    }

    function cancel(s: Session) {
      if (s.finished) return;
      s.finished = true;
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

    function release(s: Session, x: number, y: number) {
      if (s.finished) return;
      s.finished = true;
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
      swallowNextClick();
      const velocity = velocityFromSamples(s.samples);
      const list = opts.current.listRef.current;
      if (s.target.kind === "list" && list) {
        // Land where the flick is going, at most one slot further.
        const r = list.getBoundingClientRect();
        const projectedY = clamp(y + clamp(project(velocity), -s.blockHeight, s.blockHeight), r.top, r.bottom);
        finishInList(s, gapAt(s, list, projectedY), velocity);
      } else if (s.target.kind === "playlist") {
        finishOnPlaylist(s, s.target.id);
      } else {
        s.finished = false;
        cancel(s);
      }
    }

    function start(p: Pending, e: PointerEvent) {
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
        foreign: false,
        grabOffsetX: p.startX - anchorRect.left,
        grabOffsetY: p.startY - anchorRect.top,
        anchorHeight: anchor.rect.height,
        anchorLeft: anchorRect.left,
        freeX: anchorRect.left,
        x: anchorRect.left,
        xOffset: 0,
        locked: true,
        anchorOffset,
        blockHeight,
        rows,
        shifts: new Map(),
        hidden: [],
        overlay,
        samples: [{ t: e.timeStamp, y: e.clientY }],
        last: { x: e.clientX, y: e.clientY },
        target: { kind: "none" },
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
        // The row may unmount mid-drag (spring-loading another playlist);
        // keep the pointer by moving the capture to the document.
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
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      window.addEventListener("keydown", onKey, true);
      update(s, e.clientX, e.clientY);
      s.raf = requestAnimationFrame(() => step(s));
    }

    // ----- window listeners ---------------------------------------------------

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
      if (Math.abs(e.clientX - p.startX) < THRESHOLD_PX && Math.abs(e.clientY - p.startY) < THRESHOLD_PX) return;
      pendingRef.current = null;
      if (!opts.current.canStart(p.key)) {
        removePendingListeners();
        return;
      }
      start(p, e);
    }

    function onUp(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId !== s.pointerId) return;
        release(s, e.clientX, e.clientY);
        return;
      }
      if (pendingRef.current?.pointerId === e.pointerId) {
        pendingRef.current = null;
        removePendingListeners();
      }
    }

    function onCancelEvent(e: PointerEvent) {
      const s = sessionRef.current;
      if (s) {
        if (e.pointerId === s.pointerId) cancel(s);
        return;
      }
      if (pendingRef.current?.pointerId === e.pointerId) {
        pendingRef.current = null;
        removePendingListeners();
      }
    }

    function onKey(e: KeyboardEvent) {
      const s = sessionRef.current;
      if (!s || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (!s.finished) swallowClickOnRelease();
      cancel(s);
    }

    function removePendingListeners() {
      if (sessionRef.current) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancelEvent, true);
    }

    return {
      onRowPointerDown(e, key) {
        if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        if (sessionRef.current || pendingRef.current) return;
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        // No text selection may start from a row (WebKit would extend one
        // into the sidebar as the pointer crosses it); the one default worth
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
        pendingRef.current = {
          pointerId: e.pointerId,
          key,
          startX: e.clientX,
          startY: e.clientY,
          rowEl: e.currentTarget as HTMLElement,
        };
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onCancelEvent, true);
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
        s.foreign = s.blockIndices.length === 0;
        if (s.foreign) {
          // Only the grabbed clip migrates to another playlist.
          s.blockHeight = s.anchorHeight;
          s.anchorOffset = 0;
        } else {
          hideBlock(s);
        }
        s.target = { kind: "none" };
        update(s, s.last.x, s.last.y);
      },
    };
  }, []);

  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (s) {
        s.overlay.remove();
        for (const [el] of s.shifts) el.style.transform = "";
        for (const el of s.hidden) el.style.opacity = "";
        if (s.raf !== null) cancelAnimationFrame(s.raf);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        sessionRef.current = null;
      }
    },
    [],
  );

  return api;
}
