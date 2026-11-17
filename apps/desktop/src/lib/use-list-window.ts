/**
 * Draws only the rows of a long list near the view (Add clips holds every play
 * of up to ten games). The list's rows must all be `rowHeight` tall; the
 * space above and below the drawn rows is padding, so the scroll bar and
 * `scrollHeight` stay those of the whole list. The arithmetic is
 * `@scoutable/shared/lib/list-window`.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { LIST_OVERSCAN, listWindow, scrollTopToReveal, type ListWindow } from "@scoutable/shared/lib/list-window";

/** A window over a scrolling list of equal rows. `scrollRef` goes on the scrolling element. */
export function useListWindow({
  count,
  rowHeight,
  overscan = LIST_OVERSCAN,
}: {
  count: number;
  rowHeight: number;
  overscan?: number;
}): {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** What to draw now. */
  range: ListWindow;
  /** Scrolls the least needed to bring row `index` into view; nothing for no row (undefined or below 0). */
  reveal: (index: number | undefined) => void;
} {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Only the rows drawn are state: a scroll that keeps them re-renders nothing.
  const [span, setSpan] = useState({ start: 0, end: 0 });
  const countRef = useRef(count);
  countRef.current = count;

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { start, end } = listWindow({
      count: countRef.current,
      rowHeight,
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight,
      overscan,
    });
    setSpan((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [rowHeight, overscan]);

  // Scrolling and a change of the view's size move the window.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  // A new count (a filter, other games) is laid out before this runs, with the
  // scroll position already held inside the shorter list: the rows for it are
  // drawn before the frame is painted.
  useLayoutEffect(() => update(), [count, update]);

  const reveal = useCallback((index: number | undefined) => {
    const el = scrollRef.current;
    if (!el || index === undefined || index < 0) return;
    const top = scrollTopToReveal({ index, rowHeight, scrollTop: el.scrollTop, viewportHeight: el.clientHeight });
    if (top === null) return;
    el.scrollTop = top;
    update();
  }, [rowHeight, update]);

  // Until the window is measured again, a count that shrank draws no row past its end.
  const end = Math.min(span.end, count);
  const start = Math.min(span.start, end);
  const range: ListWindow = { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
  return { scrollRef, range, reveal };
}
