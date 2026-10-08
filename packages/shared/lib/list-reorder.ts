/**
 * Geometry for reordering a list by direct manipulation: where a pointer
 * lands between rows, how every other row shifts to open that gap, and
 * where the lifted rows come to rest. Rows are described by their natural
 * top and height in the list's own coordinates, in display order; the
 * desktop's pointer drag engine does the DOM work.
 */

import { moveBlock } from "./clip-groups";

export interface RowRect {
  /** Natural top, in the list's content coordinates. */
  top: number;
  height: number;
}

export interface DragLayout {
  /** Each row's new top, by original index. */
  tops: number[];
  /** Where the moving block's first row lands. */
  blockTop: number;
}

/** The gap (0..n) whose row-midpoint boundary the pointer has crossed. */
export function gapFromPointer(rects: readonly RowRect[], y: number): number {
  let gap = 0;
  for (const r of rects) {
    if (y < r.top + r.height / 2) break;
    gap++;
  }
  return gap;
}

/**
 * The rows that travel together: the multi-selection when the grabbed row
 * is part of it (else the row alone), widened to every member of any group
 * a member belongs to, in display order.
 */
export function dragBlockKeys(
  anchorKey: string,
  selectedKeys: ReadonlySet<string>,
  orderKeys: readonly string[],
  groupIdOf: ReadonlyMap<string, string>,
): string[] {
  const seed =
    selectedKeys.has(anchorKey) && selectedKeys.size > 1 ? new Set(selectedKeys) : new Set([anchorKey]);
  const gids = new Set<string>();
  for (const k of seed) {
    const g = groupIdOf.get(k);
    if (g) gids.add(g);
  }
  return orderKeys.filter((k) => seed.has(k) || gids.has(groupIdOf.get(k) ?? ""));
}

/** Natural tops after the rows at `blockIndices` move to `gap` (see moveBlock). */
export function layoutAfterMove(
  rects: readonly RowRect[],
  blockIndices: readonly number[],
  gap: number,
): DragLayout {
  const order = moveBlock(
    rects.map((_, i) => i),
    [...blockIndices],
    gap,
  );
  const blockSet = new Set(blockIndices);
  const tops = new Array<number>(rects.length);
  let y = rects[0]?.top ?? 0;
  let blockTop = y;
  let seenBlock = false;
  for (const i of order) {
    if (!seenBlock && blockSet.has(i)) {
      blockTop = y;
      seenBlock = true;
    }
    tops[i] = y;
    y += rects[i].height;
  }
  return { tops, blockTop };
}

/** Natural tops after something `height` tall is inserted at `gap`. */
export function layoutAfterInsert(rects: readonly RowRect[], gap: number, height: number): DragLayout {
  const tops = rects.map((r, i) => (i >= gap ? r.top + height : r.top));
  const last = rects[rects.length - 1];
  const blockTop = gap < rects.length ? rects[gap].top : last ? last.top + last.height : 0;
  return { tops, blockTop };
}

/** Per-row displacement (px) from the natural position to the layout's. */
export function shiftsFrom(rects: readonly RowRect[], layout: DragLayout): number[] {
  return layout.tops.map((t, i) => t - rects[i].top);
}

export function isSameOrder<T>(a: readonly T[], b: readonly T[], keyOf: (item: T) => string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (keyOf(a[i]) !== keyOf(b[i])) return false;
  return true;
}

/**
 * Where a display gap falls in the underlying items array. Display keys are
 * a subsequence of item keys (text cards and clips the viewer can't show
 * are skipped), so the gap maps to the item before which it opens; past
 * the end it appends.
 */
export function itemsIndexForGap(gap: number, displayKeys: readonly string[], itemKeys: readonly string[]): number {
  if (gap >= displayKeys.length) return itemKeys.length;
  const idx = itemKeys.indexOf(displayKeys[gap]);
  return idx >= 0 ? idx : itemKeys.length;
}
