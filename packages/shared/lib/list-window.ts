/**
 * Windowing for a long list of equal rows: which rows to draw for a scroll
 * position, with empty space above and below standing in for the rest, and
 * how far to scroll to bring one row into view.
 *
 * Pure: the desktop's lists hold the scroll position, this decides what to draw.
 */

/** The rows to draw (`start` to `end`, end not included) and the empty space above and below them, in px. */
export interface ListWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/** How many rows are drawn beyond the view on each side. */
export const LIST_OVERSCAN = 8;

/**
 * The window of a list of equal rows: the rows in view plus `overscan` either
 * side. The scroll offset is held between the top and the bottom of the list
 * first, so one left past the end by a list that got shorter draws the last
 * rows. A view of height 0 (not measured yet) draws only the overscan, the
 * first rows of the list at the top. Empty for no rows or a row height that
 * isn't positive.
 */
export function listWindow({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = LIST_OVERSCAN,
}: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): ListWindow {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const total = count * rowHeight;
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, total - viewportHeight));
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((top + viewportHeight) / rowHeight) + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/**
 * The scroll offset that brings row `index` fully into view with the least
 * movement; null when it already is. A row half out of view counts as out. A
 * row taller than the view comes to the top of it.
 */
export function scrollTopToReveal({
  index,
  rowHeight,
  scrollTop,
  viewportHeight,
}: {
  index: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): number | null {
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const target =
    rowTop < scrollTop || rowHeight > viewportHeight
      ? rowTop
      : rowBottom > scrollTop + viewportHeight
        ? rowBottom - viewportHeight
        : scrollTop;
  return target === scrollTop ? null : target;
}
